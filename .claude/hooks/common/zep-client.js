"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { ZEP_API_KEY, DEFAULT_GROUP_ID } = require('../../config');
const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';
class ZepClientError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ZepClientError';
        this.status = status;
    }
}
function getHeaders() {
    if (!ZEP_API_KEY) {
        throw new ZepClientError('ZEP_API_KEY is required for Zep Cloud');
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${ZEP_API_KEY}`,
    };
}
async function zepFetch(path, options = {}, timeoutMs = 15000) {
    const url = `${ZEP_BASE_URL}${path}`;
    const resp = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await resp.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    }
    catch (_err) {
        throw new ZepClientError(`Invalid JSON from Zep (status ${resp.status}): ${text.slice(0, 200)}`, resp.status);
    }
    if (!resp.ok) {
        const errorMsg = data.error?.message || data.error?.detail || `HTTP ${resp.status}`;
        throw new ZepClientError(errorMsg, resp.status);
    }
    return data || data.data;
}
/**
 * Add data to a user's knowledge graph
 * Supports text, JSON, or message types
 */
async function addData(params) {
    const body = {
        user_id: params.user_id,
        graph_id: params.graph_id,
        type: params.type,
        data: params.data,
        source: params.source || 'lisa-memory',
    };
    return zepFetch('/graph/add', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}
/**
 * Search the knowledge graph for facts, nodes, or episodes
 */
async function search(params) {
    const body = {
        query: params.query,
        user_id: params.user_id,
        graph_id: params.graph_id,
        limit: params.limit || 10,
        search_scope: params.search_scope || 'facts',
    };
    return zepFetch('/graph/search', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}
/**
 * Ensure a user exists in Zep (creates if not present)
 */
async function ensureUser(userId, metadata) {
    try {
        // Try to get the user first
        await zepFetch(`/users/${encodeURIComponent(userId)}`, { method: 'GET' });
    }
    catch (err) {
        // User doesn't exist, create them
        if (err instanceof ZepClientError && err.status === 404) {
            await zepFetch('/users', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: userId,
                    metadata: metadata || {},
                }),
            });
        }
        else {
            throw err;
        }
    }
}
/**
 * Get user's nodes from the knowledge graph
 */
async function getUserNodes(userId, limit = 50) {
    const result = await zepFetch(`/graph/node/user/${encodeURIComponent(userId)}`, {
        method: 'POST',
        body: JSON.stringify({ limit }),
    });
    return result.nodes || [];
}
/**
 * Add memory (convenience wrapper matching MCP interface)
 * @param text The text content to store
 * @param options Additional options
 */
async function addMemory(text, options = {}) {
    const groupId = options.groupId || DEFAULT_GROUP_ID;
    // Use graph_id for group-based storage (not user-specific)
    const result = await addData({
        graph_id: groupId,
        type: 'text',
        data: text,
        source: options.source || 'lisa-memory',
    });
    return {
        status: 'ok',
        episode_uuid: result.episode_uuid,
    };
}
/**
 * Search memory facts (convenience wrapper matching MCP interface)
 * @param query Search query
 * @param options Additional options
 */
async function searchMemoryFacts(query, options = {}) {
    const groupId = options.groupId || DEFAULT_GROUP_ID;
    const result = await search({
        query,
        graph_id: groupId,
        limit: options.limit || 10,
        search_scope: 'facts',
    });
    return {
        facts: result.facts || [],
    };
}
/**
 * Check if Zep Cloud is configured and reachable
 */
async function healthCheck() {
    try {
        if (!ZEP_API_KEY) {
            return { status: 'error', message: 'ZEP_API_KEY not configured' };
        }
        // Try to list users as a health check
        await zepFetch('/users', { method: 'GET' });
        return { status: 'ok', message: 'Zep Cloud connected' };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'error', message };
    }
}
module.exports = {
    addMemory,
    searchMemoryFacts,
    addData,
    search,
    ensureUser,
    getUserNodes,
    healthCheck,
    ZepClientError,
    ZEP_BASE_URL,
};
