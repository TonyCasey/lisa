/**
 * Zep Cloud Native API Client
 * Direct REST API integration for Zep Cloud (no MCP required)
 * API Docs: https://help.getzep.com/
 */
export {}; // mark as module to keep scoped declarations

const { ZEP_API_KEY, DEFAULT_GROUP_ID } = require('../../config');

const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';

interface ZepError {
  message?: string;
  detail?: string;
}

interface ZepResponse<T = unknown> {
  data?: T;
  error?: ZepError;
}

interface ZepFact {
  uuid: string;
  name: string;
  fact: string;
  created_at: string;
  valid_at?: string;
  invalid_at?: string;
}

interface ZepNode {
  uuid: string;
  name: string;
  summary?: string;
  labels?: string[];
  created_at: string;
}

interface ZepEpisode {
  uuid: string;
  content: string;
  source?: string;
  created_at: string;
}

interface SearchResult {
  facts?: ZepFact[];
  nodes?: ZepNode[];
  episodes?: ZepEpisode[];
}

interface AddDataParams {
  user_id?: string;
  graph_id?: string;
  type: 'text' | 'json' | 'message';
  data: string;
  source?: string;
}

interface SearchParams {
  query: string;
  user_id?: string;
  graph_id?: string;
  limit?: number;
  search_scope?: 'facts' | 'nodes' | 'edges' | 'episodes';
}

class ZepClientError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ZepClientError';
    this.status = status;
  }
}

function getHeaders(): Record<string, string> {
  if (!ZEP_API_KEY) {
    throw new ZepClientError('ZEP_API_KEY is required for Zep Cloud');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Api-Key ${ZEP_API_KEY}`,
  };
}

async function zepFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<T> {
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
  let data: ZepResponse<T>;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (_err) {
    throw new ZepClientError(
      `Invalid JSON from Zep (status ${resp.status}): ${text.slice(0, 200)}`,
      resp.status
    );
  }

  if (!resp.ok) {
    const errorMsg = data.error?.message || data.error?.detail || `HTTP ${resp.status}`;
    throw new ZepClientError(errorMsg, resp.status);
  }

  return (data as T) || (data.data as T);
}

/**
 * Add data to a user's knowledge graph
 * Supports text, JSON, or message types
 */
async function addData(params: AddDataParams): Promise<{ episode_uuid: string }> {
  const body = {
    user_id: params.user_id,
    graph_id: params.graph_id,
    type: params.type,
    data: params.data,
    source: params.source || 'lisa-memory',
  };

  return zepFetch<{ episode_uuid: string }>('/graph/add', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Search the knowledge graph for facts, nodes, or episodes
 */
async function search(params: SearchParams): Promise<SearchResult> {
  const body = {
    query: params.query,
    user_id: params.user_id,
    graph_id: params.graph_id,
    limit: params.limit || 10,
    search_scope: params.search_scope || 'facts',
  };

  return zepFetch<SearchResult>('/graph/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Ensure a user exists in Zep (creates if not present)
 */
async function ensureUser(userId: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    // Try to get the user first
    await zepFetch(`/users/${encodeURIComponent(userId)}`, { method: 'GET' });
  } catch (err) {
    // User doesn't exist, create them
    if (err instanceof ZepClientError && err.status === 404) {
      await zepFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          metadata: metadata || {},
        }),
      });
    } else {
      throw err;
    }
  }
}

/**
 * Get user's nodes from the knowledge graph
 */
async function getUserNodes(
  userId: string,
  limit = 50
): Promise<ZepNode[]> {
  const result = await zepFetch<{ nodes: ZepNode[] }>(
    `/graph/node/user/${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }
  );
  return result.nodes || [];
}

/**
 * Add memory (convenience wrapper matching MCP interface)
 * @param text The text content to store
 * @param options Additional options
 */
async function addMemory(
  text: string,
  options: {
    groupId?: string;
    source?: string;
    tags?: string[];
  } = {}
): Promise<{ status: string; episode_uuid?: string }> {
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
async function searchMemoryFacts(
  query: string,
  options: {
    groupId?: string;
    limit?: number;
  } = {}
): Promise<{ facts: ZepFact[] }> {
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
async function healthCheck(): Promise<{ status: string; message: string }> {
  try {
    if (!ZEP_API_KEY) {
      return { status: 'error', message: 'ZEP_API_KEY not configured' };
    }
    // Try to list users as a health check
    await zepFetch('/users', { method: 'GET' });
    return { status: 'ok', message: 'Zep Cloud connected' };
  } catch (err) {
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
