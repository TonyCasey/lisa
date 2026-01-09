#!/usr/bin/env node
// Model-neutral task helper for Graphiti MCP with cache fallback.
// Commands:
//   node tasks.js list [--group <id>] [--limit N] [--cache] [--endpoint <url>]
//   node tasks.js add "task text" [--status todo|doing|done] [--tag foo] [--group <id>] [--cache] [--endpoint <url>]
// Modes:
//   local        : Local Docker MCP server (default)
//   remote-neo4j : Remote Neo4j with local Docker MCP
//   zep-cloud    : Zep Cloud native REST API (no Docker required)

export {}; // ensure module scope to avoid global collisions across templates

const fs = require('fs');
const path = require('path');

// ============================================================================
// Zep Cloud Native API Client (for zep-cloud mode)
// ============================================================================
const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';

async function zepFetch(
  apiKey: string,
  urlPath: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<any> {
  const url = `${ZEP_BASE_URL}${urlPath}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${apiKey}`,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_err) {
    throw new Error(`Invalid JSON from Zep (${resp.status}): ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const errorMsg =
      data.message ||
      data.error?.message ||
      data.error?.detail ||
      `HTTP ${resp.status}`;
    throw new Error(errorMsg);
  }
  return data;
}

async function zepEnsureUser(apiKey: string, userId: string) {
  try {
    await zepFetch(apiKey, '/users', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        first_name: 'Lisa',
        last_name: 'Tasks',
      }),
    });
  } catch (err) {
    if (!(err instanceof Error && err.message.includes('already exists'))) {
      throw err;
    }
  }
  return { user_id: userId };
}

async function zepGetOrCreateThread(apiKey: string, threadId: string, userId: string) {
  try {
    await zepFetch(apiKey, '/threads', {
      method: 'POST',
      body: JSON.stringify({
        thread_id: threadId,
        user_id: userId,
        metadata: { project: threadId, type: 'tasks', created_by: 'lisa' },
      }),
    });
  } catch (err) {
    if (!(err instanceof Error && err.message.includes('already exists'))) {
      throw err;
    }
  }
  return { thread_id: threadId };
}

async function zepAddTask(
  apiKey: string,
  taskObj: Record<string, unknown>,
  groupId: string
): Promise<{ message_uuid?: string }> {
  const userId = `lisa-${groupId}`;
  const threadId = `lisa-tasks-${groupId}`;

  await zepEnsureUser(apiKey, userId);
  await zepGetOrCreateThread(apiKey, threadId, userId);

  // Store task as JSON in message content for later retrieval
  const result = await zepFetch(
    apiKey,
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            role_type: 'user',
            content: `TASK: ${JSON.stringify(taskObj)}`,
          },
        ],
      }),
    }
  );
  return { message_uuid: result.message_uuids?.[0] };
}

async function zepGetMessages(
  apiKey: string,
  groupId: string,
  limit: number
): Promise<any[]> {
  const threadId = `lisa-tasks-${groupId}`;
  try {
    const result = await zepFetch(
      apiKey,
      `/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`
    );
    return result.messages || [];
  } catch (err) {
    // Thread may not exist yet
    if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
      return [];
    }
    throw err;
  }
}

function parseTasksFromZepMessages(messages: any[], repo: string, assignee: string) {
  return messages
    .map((m) => {
      const content = m.content || '';
      if (!content.startsWith('TASK:')) return null;

      const jsonStr = content.slice(5).trim();
      try {
        const obj = JSON.parse(jsonStr);
        if (obj && obj.type === 'task') {
          return {
            title: obj.title,
            status: obj.status,
            repo: obj.repo || repo,
            assignee: obj.assignee || assignee,
            notes: obj.notes,
            tag: obj.tag,
            message_uuid: m.uuid,
            created_at: m.created_at,
          };
        }
      } catch (_) {
        // Not valid JSON, try to extract title
        return {
          title: jsonStr.slice(0, 120),
          status: 'unknown',
          repo,
          assignee,
          message_uuid: m.uuid,
          created_at: m.created_at,
        };
      }
      return null;
    })
    .filter(Boolean);
}

// ============================================================================
// End Zep Cloud Client
// ============================================================================

const args: string[] = process.argv.slice(2);
const env = (() => {
  // Read from .agents/.env (3 levels up from skills/tasks/scripts/)
  const envPath = path.join(__dirname, '..', '..', '..', '.env');
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });
  } catch (_) {
    // optional .env; ignore if missing
  }
  return out;
})();

function popFlag(name: string, fallback: string): string;
function popFlag(name: string, fallback: null): string | null;
function popFlag(name: string, fallback: string | null): string | null {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val ?? fallback;
}
function hasFlag(name: string) {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

const command = args.shift() ?? '';
const endpoint: string = popFlag('--endpoint', env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/');
const groupId = popFlag('--group', env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || 'lisa');
const limit = Number(popFlag('--limit', '20')) || 20;
const status = popFlag('--status', 'todo');
const tag = popFlag('--tag', null);
const repo: string = popFlag('--repo', path.basename(process.cwd()) || 'unknown') as string;
const assignee: string = (popFlag('--assignee', process.env.USER || 'unknown') || 'unknown') as string;
const notes = popFlag('--notes', '');
const useCache = hasFlag('--cache');
const payload = args.join(' ').trim();
const cacheFile = path.join(__dirname, '..', 'cache', 'tasks.log');

// Mode detection
const graphitiMode = env.GRAPHITI_MODE || process.env.GRAPHITI_MODE || 'local';
const zepApiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
const isZepCloud = graphitiMode === 'zep-cloud';

async function initialize() {
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
      clientInfo: { name: 'tasks-skill', version: '0.1.0' },
    },
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`initialize failed: ${resp.status}`);
  const sid = resp.headers.get('mcp-session-id');
  if (!sid) throw new Error('missing mcp-session-id');
  return sid;
}

async function rpcCall(method: string, params: unknown, sessionId: string) {
  const payload = method === 'initialize' || method === 'ping' || method.startsWith('tools/')
    ? { jsonrpc: '2.0', id: '1', method, params }
    : { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: method, arguments: params } };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'MCP-SESSION-ID': sessionId, Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(payload),
  });
  let text = await resp.text();
  if (text.startsWith('event:')) {
    const dataLine = text.split('\n').find((l: string) => l.startsWith('data:'));
    if (dataLine) text = dataLine.slice(5).trim();
  }
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(`bad JSON: ${text.slice(0, 160)}`); }
  if (!resp.ok || data.error) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  return data.result?.structuredContent?.result || data.result || data;
}

// ============================================================================
// MCP Mode Functions (local or remote-neo4j)
// ============================================================================

async function addTask(sessionId: string) {
  if (!payload) throw new Error('add requires task text (title)');
  const taskObj = { type: 'task', title: payload, status, repo, assignee, notes, tag };
  const params = {
    name: `TASK: ${payload.slice(0, 60)}`,
    episode_body: JSON.stringify(taskObj),
    source: 'json',
    group_id: groupId,
    tags: tag ? [tag] : undefined,
  };
  const result = await rpcCall('add_memory', params, sessionId);
  return { status: 'ok', action: 'add', task: taskObj, group: groupId, result };
}

async function updateTask(sessionId: string) {
  if (!payload) throw new Error('update requires task text (title)');
  const taskObj = { type: 'task', title: payload, status, repo, assignee, notes, tag, updated: true };
  const params = {
    name: `TASK UPDATE: ${payload.slice(0, 60)}`,
    episode_body: JSON.stringify(taskObj),
    source: 'json',
    group_id: groupId,
    tags: tag ? [tag] : undefined,
  };
  const result = await rpcCall('add_memory', params, sessionId);
  return { status: 'ok', action: 'update', task: taskObj, group: groupId, result };
}

function parseTasksFromEpisodes(episodes: any[]) {
  return episodes
    .map((e) => {
      const content = e.content || e.episode_body || '';
      let obj: any = null;
      try { obj = JSON.parse(content); } catch (_) { /* ignore */ }
      if (obj && obj.type === 'task') {
        return {
          title: obj.title,
          status: obj.status,
          repo: obj.repo,
          assignee: obj.assignee,
          notes: obj.notes,
          tag: obj.tag,
          episode_uuid: e.uuid,
          created_at: e.created_at,
        };
      }
      if (typeof content === 'string' && content.trim().toUpperCase().startsWith('TASK')) {
        return { title: content.slice(0, 120), status: 'unknown', repo, assignee, episode_uuid: e.uuid, created_at: e.created_at };
      }
      return null;
    })
    .filter(Boolean);
}

async function listTasks(sessionId: string) {
  const params = { group_ids: [groupId], max_episodes: limit };
  const result = await rpcCall('get_episodes', params, sessionId);
  const episodes = (result as any)?.episodes || (result as any)?.result?.episodes || [];
  const tasks = parseTasksFromEpisodes(episodes);
  return { status: 'ok', action: 'list', tasks };
}

// ============================================================================
// Zep Cloud Mode Functions (no MCP/Docker required)
// ============================================================================

async function addTaskZep() {
  if (!payload) throw new Error('add requires task text (title)');
  if (!zepApiKey) throw new Error('ZEP_API_KEY required for zep-cloud mode');

  const taskObj = { type: 'task', title: payload, status, repo, assignee, notes, tag };
  const result = await zepAddTask(zepApiKey, taskObj, groupId);

  return {
    status: 'ok',
    action: 'add',
    task: taskObj,
    group: groupId,
    message_uuid: result.message_uuid,
    mode: 'zep-cloud',
  };
}

async function updateTaskZep() {
  if (!payload) throw new Error('update requires task text (title)');
  if (!zepApiKey) throw new Error('ZEP_API_KEY required for zep-cloud mode');

  const taskObj = { type: 'task', title: payload, status, repo, assignee, notes, tag, updated: true };
  const result = await zepAddTask(zepApiKey, taskObj, groupId);

  return {
    status: 'ok',
    action: 'update',
    task: taskObj,
    group: groupId,
    message_uuid: result.message_uuid,
    mode: 'zep-cloud',
  };
}

async function listTasksZep() {
  if (!zepApiKey) throw new Error('ZEP_API_KEY required for zep-cloud mode');

  const messages = await zepGetMessages(zepApiKey, groupId, limit);
  const tasks = parseTasksFromZepMessages(messages, repo, assignee);

  return {
    status: 'ok',
    action: 'list',
    tasks,
    mode: 'zep-cloud',
  };
}

// ============================================================================
// Cache Functions
// ============================================================================

function writeCache(obj: Record<string, unknown>) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
    fs.appendFileSync(cacheFile, `${line}\n`, 'utf8');
  } catch (err: unknown) {
    // ignore cache errors
  }
}

function readCacheFallback(): Record<string, unknown> | null {
  try {
    const data = fs.readFileSync(cacheFile, 'utf8').trim().split('\n').filter(Boolean);
    if (!data.length) return null;
    return data.slice(-1).map((l: string) => JSON.parse(l))[0] as Record<string, unknown>;
  } catch (err: unknown) {
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    if (!['add', 'list', 'update'].includes(command)) throw new Error('command must be add|list|update');

    let out;
    if (isZepCloud) {
      // Zep Cloud mode: use native REST API (no Docker/MCP required)
      out =
        command === 'add'
          ? await addTaskZep()
          : command === 'update'
            ? await updateTaskZep()
            : await listTasksZep();
    } else {
      // MCP mode: local or remote-neo4j (requires Docker MCP server)
      const sid = await initialize();
      out =
        command === 'add'
          ? await addTask(sid)
          : command === 'update'
            ? await updateTask(sid)
            : await listTasks(sid);
    }

    if (useCache) writeCache(out as Record<string, unknown>);
    console.log(JSON.stringify(out, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = useCache ? readCacheFallback() : null;
    if (fallback) {
      console.log(JSON.stringify({ status: 'fallback', error: message, fallback }, null, 2));
      return;
    }
    console.error(message);
    process.exit(1);
  }
}

main();
