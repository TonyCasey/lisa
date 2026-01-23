import type { IMcpClient } from '../../domain/interfaces';
import { McpError } from '../../domain/errors';
import fs from 'fs-extra';
import path from 'path';

// Read version from package.json
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', 'package.json');
const VERSION = fs.existsSync(PACKAGE_JSON_PATH) 
  ? (fs.readJsonSync(PACKAGE_JSON_PATH) as { version: string }).version 
  : '0.0.0';

const CLIENT_INFO = { name: 'lisa', version: VERSION };
const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_MS = 8000;

interface McpResponse {
  result?: {
    structuredContent?: {
      result?: unknown;
    };
    facts?: unknown[];
    nodes?: unknown[];
  };
  facts?: unknown[];
  nodes?: unknown[];
  error?: {
    message?: string;
  };
}

/**
 * MCP Client implementation.
 * Communicates with Graphiti MCP server or Zep Cloud.
 *
 * Session Management:
 * This client manages MCP sessions internally. It:
 * - Automatically initializes a session on first call
 * - Updates session ID when server returns a new one in response headers
 * - Re-initializes session if a request fails with 401/403 (expired session)
 * - Thread-safe for concurrent requests (all share the same session)
 *
 * Callers should NOT track session IDs manually - the client handles this.
 */
export class McpClient implements IMcpClient {
  private sessionId: string | null = null;
  private initializePromise: Promise<string> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string
  ) {}

  /**
   * Get headers for MCP requests.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Add Zep auth header when using Zep Cloud
    if (this.apiKey && this.endpoint.includes('getzep.com')) {
      headers['Authorization'] = `Api-Key ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Extract data from SSE response.
   */
  private extractEventStreamData(text: string): McpResponse | null {
    const lines = text.split('\n').map((l) => l.trim());
    const dataLines = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.replace(/^data:\s*/, ''));

    if (!dataLines.length) return null;

    const candidate = dataLines.join('\n');
    try {
      return JSON.parse(candidate) as McpResponse;
    } catch {
      return null;
    }
  }

  /**
   * Initialize the MCP session.
   * Uses a promise cache to prevent concurrent initialization requests.
   */
  async initialize(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    // If already initializing, return the pending promise
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // If already have a session, return it
    if (this.sessionId) {
      return this.sessionId;
    }

    // Start initialization
    this.initializePromise = this.doInitialize(timeoutMs);

    try {
      const sessionId = await this.initializePromise;
      return sessionId;
    } finally {
      this.initializePromise = null;
    }
  }

  /**
   * Internal initialization logic.
   */
  private async doInitialize(timeoutMs: number): Promise<string> {
    const body = {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    };

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const session = resp.headers.get('mcp-session-id');
    if (!session) {
      throw new McpError('No mcp-session-id header from MCP', resp.status);
    }

    this.sessionId = session;
    return this.sessionId;
  }

  /**
   * Force re-initialization of the session.
   * Called when a request fails with session-related errors.
   */
  private async reinitialize(timeoutMs: number): Promise<string> {
    this.sessionId = null;
    this.initializePromise = null;
    return this.initialize(timeoutMs);
  }

  /**
   * Make an RPC call to the MCP server.
   *
   * Session management is handled internally:
   * - Session is initialized automatically on first call
   * - Session ID from response headers updates the internal state
   * - On 401/403, session is re-initialized and request retried once
   *
   * @param method - Method name
   * @param params - Method parameters
   * @param _sessionId - DEPRECATED: Ignored. Session managed internally.
   * @param timeoutMs - Timeout in milliseconds
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    _sessionId: string | null = null, // Ignored - session managed internally
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<[T, string]> {
    return this.doCall<T>(method, params, timeoutMs, false);
  }

  /**
   * Internal call implementation with retry logic for session expiry.
   */
  private async doCall<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    isRetry: boolean
  ): Promise<[T, string]> {
    // Always use internal session ID, never the passed one
    const sid = this.sessionId || (await this.initialize(timeoutMs));

    const headers = {
      ...this.getHeaders(),
      'MCP-SESSION-ID': sid,
    };

    // Wrap tool calls in tools/call format
    const payload =
      method === 'initialize' || method === 'ping' || method.startsWith('tools/')
        ? { jsonrpc: '2.0', id: '1', method, params }
        : { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: method, arguments: params } };

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Update session ID from response
    const newSid = resp.headers.get('mcp-session-id');
    if (newSid) {
      this.sessionId = newSid;
    }

    // Handle session expiry - retry once with fresh session
    if ((resp.status === 401 || resp.status === 403) && !isRetry) {
      await this.reinitialize(timeoutMs);
      return this.doCall<T>(method, params, timeoutMs, true);
    }

    const text = await resp.text();
    let data: McpResponse;

    try {
      data = JSON.parse(text) as McpResponse;
    } catch {
      const eventParsed = this.extractEventStreamData(text);
      if (eventParsed) {
        data = eventParsed;
      } else {
        const snippet = text ? text.slice(0, 200) : '<empty>';
        throw new McpError(`Invalid JSON from MCP (status ${resp.status || 'unknown'}): ${snippet}`, resp.status);
      }
    }

    if (resp.status >= 400) {
      const msg = data?.error?.message || `HTTP ${resp.status}`;
      throw new McpError(msg, resp.status);
    }

    if (data.error) {
      throw new McpError(data.error.message || 'RPC error');
    }

    const result = (data.result?.structuredContent?.result || data.result || data) as T;
    return [result, this.sessionId as string];
  }

  /**
   * Check if the MCP server is reachable.
   */
  async ping(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    try {
      await this.call('ping', {}, null, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}
