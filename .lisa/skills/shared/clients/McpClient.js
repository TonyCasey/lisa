"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpClient = createMcpClient;
exports.createMcpConfigFromEnv = createMcpConfigFromEnv;
/**
 * Creates an MCP client instance.
 */
function createMcpClient(config) {
    let sessionId = null;
    const endpoint = config.endpoint;
    const clientName = config.clientName ?? 'lisa-skill';
    const clientVersion = config.clientVersion ?? '0.1.0';
    const timeoutMs = config.timeoutMs ?? 30000;
    return {
        async initialize() {
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
        async rpcCall(method, params) {
            if (!sessionId) {
                throw new Error('MCP client not initialized. Call initialize() first.');
            }
            // Determine the correct payload structure
            const isRawMethod = method === 'initialize' ||
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
            let data;
            try {
                data = JSON.parse(text);
            }
            catch (_err) {
                throw new Error(`MCP bad JSON response: ${text.slice(0, 160)}`);
            }
            if (!resp.ok || data.error) {
                throw new Error(data.error?.message || `MCP HTTP ${resp.status}`);
            }
            // Extract result from various response structures
            return (data.result?.structuredContent?.result ||
                data.result ||
                data);
        },
        getSessionId() {
            return sessionId;
        },
        isInitialized() {
            return sessionId !== null;
        },
    };
}
/**
 * Creates MCP client config from environment variables.
 */
function createMcpConfigFromEnv(env = {}) {
    return {
        endpoint: env.GRAPHITI_ENDPOINT ||
            process.env.GRAPHITI_ENDPOINT ||
            'http://localhost:8010/mcp/',
    };
}
//# sourceMappingURL=McpClient.js.map