/**
 * MCP (Model Context Protocol) client implementation.
 * Used for communicating with Graphiti MCP server.
 */
import type { IMcpClient, IMcpClientConfig, IMcpRpcResponse } from './interfaces';

/**
 * Creates an MCP client instance.
 */
export function createMcpClient(config: IMcpClientConfig): IMcpClient {
  let sessionId: string | null = null;
  const endpoint = config.endpoint;
  const clientName = config.clientName ?? 'lisa-skill';
  const clientVersion = config.clientVersion ?? '0.1.0';
  const timeoutMs = config.timeoutMs ?? 30000;

  return {
    async initialize(): Promise<string> {
      const body = {
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            experimental: {},
            prompts: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            tools: { listChanged: false },
          },
          clientInfo: { name: clientName, version: clientVersion },
        },
      };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        throw new Error(`MCP initialize failed: HTTP ${resp.status}`);
      }

      const sid = resp.headers.get('mcp-session-id');
      if (!sid) {
        throw new Error('MCP initialize failed: missing mcp-session-id header');
      }

      sessionId = sid;
      return sid;
    },

    async rpcCall<T>(
      method: string,
      params: Record<string, unknown>
    ): Promise<T> {
      if (!sessionId) {
        throw new Error('MCP client not initialized. Call initialize() first.');
      }

      // Determine the correct payload structure
      const isRawMethod =
        method === 'initialize' ||
        method === 'ping' ||
        method.startsWith('tools/');

      const payload = isRawMethod
        ? { jsonrpc: '2.0', id: '1', method, params }
        : {
            jsonrpc: '2.0',
            id: '1',
            method: 'tools/call',
            params: { name: method, arguments: params },
          };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'MCP-SESSION-ID': sessionId,
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      let text = await resp.text();

      // MCP servers may wrap JSON in Server-Sent Events; unwrap if present
      if (text.startsWith('event:')) {
        const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          text = dataLine.slice(5).trim();
        }
      }

      let data: IMcpRpcResponse<T>;
      try {
        data = JSON.parse(text);
      } catch (_err) {
        throw new Error(`MCP bad JSON response: ${text.slice(0, 160)}`);
      }

      if (!resp.ok || data.error) {
        throw new Error(data.error?.message || `MCP HTTP ${resp.status}`);
      }

      // Extract result from various response structures
      return (
        (data.result?.structuredContent?.result as T) ||
        (data.result as T) ||
        (data as unknown as T)
      );
    },

    getSessionId(): string | null {
      return sessionId;
    },

    isInitialized(): boolean {
      return sessionId !== null;
    },
  };
}

/**
 * Creates MCP client config from environment variables.
 */
export function createMcpConfigFromEnv(
  env: Record<string, string> = {}
): IMcpClientConfig {
  return {
    endpoint:
      env.GRAPHITI_ENDPOINT ||
      process.env.GRAPHITI_ENDPOINT ||
      'http://localhost:8010/mcp/',
  };
}
