"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { MCP_ENDPOINT, ZEP_API_KEY } = require('../../config');
const { getCurrentGroupId, getHierarchicalGroupIds } = require('./group-id');
const CLIENT_INFO = { name: 'claude-hooks', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';
/**
 * Get headers for MCP requests.
 * Adds Zep API key authentication when using Zep Cloud endpoint.
 */
function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    };
    // Add Zep auth header when using Zep Cloud
    if (ZEP_API_KEY && MCP_ENDPOINT.includes('getzep.com')) {
        headers['Authorization'] = `Api-Key ${ZEP_API_KEY}`;
    }
    return headers;
}
let SESSION_ID = null;
class MCPError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
function extractEventStreamData(text) {
    const lines = text.split('\n').map((l) => l.trim());
    const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.replace(/^data:\s*/, ''));
    if (!dataLines.length)
        return null;
    const candidate = dataLines.join('\n');
    try {
        return JSON.parse(candidate);
    }
    catch (_err) {
        return null;
    }
}
async function initialize(timeoutMs = 8000) {
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
    const resp = await fetch(MCP_ENDPOINT, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const session = resp.headers.get('mcp-session-id');
    if (!session)
        throw new MCPError('No mcp-session-id header from MCP', resp.status);
    SESSION_ID = session;
    return SESSION_ID;
}
async function rpcCall(method, params = {}, sessionId = null, timeoutMs = 8000) {
    const sid = sessionId || SESSION_ID || (await initialize(timeoutMs));
    const headers = { ...getHeaders(), 'MCP-SESSION-ID': sid };
    const payload = method === 'initialize' || method === 'ping' || method.startsWith('tools/')
        ? { jsonrpc: '2.0', id: '1', method, params }
        : { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: method, arguments: params } };
    const resp = await fetch(MCP_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const newSid = resp.headers.get('mcp-session-id');
    if (newSid)
        SESSION_ID = newSid;
    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (_err) {
        const eventParsed = extractEventStreamData(text);
        if (eventParsed) {
            data = eventParsed;
        }
        else {
            const snippet = text ? text.slice(0, 200) : '<empty>';
            throw new MCPError(`Invalid JSON from MCP (status ${resp.status || 'unknown'}): ${snippet}`);
        }
    }
    if (resp.status >= 400) {
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        throw new MCPError(msg, resp.status);
    }
    if (data.error)
        throw new MCPError(data.error.message || 'RPC error');
    const result = data.result?.structuredContent?.result || data.result || data;
    return [result, SESSION_ID];
}
/**
 * Add a single group ID to params (for write operations).
 * Uses the current folder's group ID if not specified.
 */
function withGroup(params, groupId = null) {
    if (params.group_ids)
        return params;
    return { ...params, group_ids: [groupId || getCurrentGroupId()] };
}
/**
 * Add hierarchical group IDs to params (for read operations).
 * Queries current folder + all parent folders up to $HOME.
 */
function withHierarchicalGroups(params) {
    if (params.group_ids)
        return params;
    return { ...params, group_ids: getHierarchicalGroupIds() };
}
module.exports = {
    rpcCall,
    withGroup,
    withHierarchicalGroups,
    initialize,
    MCP_ENDPOINT,
    getCurrentGroupId,
    getHierarchicalGroupIds,
    MCPError,
};
