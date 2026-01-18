import type { IMcpClient } from '../../domain/interfaces';
import { McpError } from '../../domain/errors';

const CLIENT_INFO = { name: 'lisa', version: '0.1.0' };
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
 */
export class McpClient implements IMcpClient {
  private sessionId: string | null = null;

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
   */
  async initialize(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
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
   * Make an RPC call to the MCP server.
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId: string | null = null,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<[T, string]> {
    const sid = sessionId || this.sessionId || (await this.initialize(timeoutMs));

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

    const newSid = resp.headers.get('mcp-session-id');
    if (newSid) {
      this.sessionId = newSid;
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
