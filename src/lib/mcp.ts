const DEFAULT_BODY = {
  jsonrpc: '2.0',
  id: 'init',
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'lisa', version: '0.5.0' },
  },
};

export interface PingMcpOptions {
  apiKey?: string;
}

export async function pingMcp(
  endpoint: string,
  options?: PingMcpOptions
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  // Add Authorization header for Zep Cloud mode
  if (options?.apiKey) {
    headers['Authorization'] = `Api-Key ${options.apiKey}`;
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(DEFAULT_BODY),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const session = resp.headers.get('mcp-session-id');
  if (!session) {
    throw new Error('No mcp-session-id header returned');
  }
}
