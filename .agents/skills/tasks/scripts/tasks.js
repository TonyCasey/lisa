#!/usr/bin/env node
"use strict";
// Model-neutral task helper for Graphiti MCP with cache fallback.
// Commands:
//   node tasks.js list [--group <id>] [--limit N] [--cache] [--endpoint <url>]
//   node tasks.js add "task text" [--status todo|doing|done] [--tag foo] [--group <id>] [--cache] [--endpoint <url>]
// Modes:
//   local        : Local Docker MCP server (default)
//   zep-cloud    : Zep Cloud native REST API (no Docker required)
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const os = require('os');
// ============================================================================
// Group ID Utilities (inline to avoid import complexity in deployed skills)
// ============================================================================
const MAX_GROUP_ID_LENGTH = 128;
function normalizePathToGroupId(absolutePath) {
    let normalized = absolutePath
        .toLowerCase()
        .replace(/^\//, '')
        .replace(/\//g, '-')
        .replace(/\./g, '_'); // Graphiti requires alphanumeric, dashes, underscores only
    if (normalized.length > MAX_GROUP_ID_LENGTH) {
        normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
    }
    return normalized;
}
function getCurrentGroupId(cwd = process.cwd()) {
    return normalizePathToGroupId(cwd);
}
function getHierarchicalGroupIds(cwd = process.cwd()) {
    const homeDir = os.homedir();
    const groups = [];
    let currentPath = path.resolve(cwd);
    while (currentPath.length >= homeDir.length) {
        groups.push(normalizePathToGroupId(currentPath));
        if (currentPath === homeDir)
            break;
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath)
            break;
        currentPath = parentPath;
    }
    return groups;
}
// ============================================================================
// Zep Cloud Native API Client (for zep-cloud mode)
// ============================================================================
const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';
async function zepFetch(apiKey, urlPath, options = {}, timeoutMs = 15000) {
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
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    }
    catch (_err) {
        throw new Error(`Invalid JSON from Zep (${resp.status}): ${text.slice(0, 200)}`);
    }
    if (!resp.ok) {
        const errorMsg = data.message ||
            data.error?.message ||
            data.error?.detail ||
            `HTTP ${resp.status}`;
        throw new Error(errorMsg);
    }
    return data;
}
async function zepEnsureUser(apiKey, userId) {
    try {
        await zepFetch(apiKey, '/users', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                first_name: 'Lisa',
                last_name: 'Tasks',
            }),
        });
    }
    catch (err) {
        if (!(err instanceof Error && err.message.includes('already exists'))) {
            throw err;
        }
    }
    return { user_id: userId };
}
async function zepGetOrCreateThread(apiKey, threadId, userId) {
    try {
        await zepFetch(apiKey, '/threads', {
            method: 'POST',
            body: JSON.stringify({
                thread_id: threadId,
                user_id: userId,
                metadata: { project: threadId, type: 'tasks', created_by: 'lisa' },
            }),
        });
    }
    catch (err) {
        if (!(err instanceof Error && err.message.includes('already exists'))) {
            throw err;
        }
    }
    return { thread_id: threadId };
}
async function zepAddTask(apiKey, taskObj, groupId) {
    const userId = `lisa-${groupId}`;
    const threadId = `lisa-tasks-${groupId}`;
    await zepEnsureUser(apiKey, userId);
    await zepGetOrCreateThread(apiKey, threadId, userId);
    // Store task as JSON in message content for later retrieval
    const result = await zepFetch(apiKey, `/threads/${encodeURIComponent(threadId)}/messages`, {
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
    });
    return { message_uuid: result.message_uuids?.[0] };
}
async function zepGetMessages(apiKey, groupIds, limit) {
    const allMessages = [];
    // Fetch from all hierarchical groups
    for (const gid of groupIds) {
        const threadId = `lisa-tasks-${gid}`;
        try {
            const result = await zepFetch(apiKey, `/threads/${encodeURIComponent(threadId)}/messages?limit=${Math.ceil(limit / groupIds.length)}`);
            allMessages.push(...(result.messages || []));
        }
        catch (err) {
            // Thread may not exist yet, continue to next
            if (!(err instanceof Error && (err.message.includes('not found') || err.message.includes('404')))) {
                throw err;
            }
        }
    }
    // Sort by created_at descending
    allMessages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return allMessages.slice(0, limit);
}
function parseTasksFromZepMessages(messages, repo, assignee) {
    return messages
        .map((m) => {
        const content = m.content || '';
        if (!content.startsWith('TASK:'))
            return null;
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
        }
        catch (_) {
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
const args = process.argv.slice(2);
const env = (() => {
    // Read from .agents/skills/.env (2 levels up from tasks/scripts/)
    const envPath = path.join(__dirname, '..', '..', '.env');
    const out = {};
    try {
        const raw = fs.readFileSync(envPath, 'utf8');
        raw.split(/\r?\n/).forEach((line) => {
            if (!line || line.startsWith('#'))
                return;
            const idx = line.indexOf('=');
            if (idx === -1)
                return;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            out[key] = val;
        });
    }
    catch (_) {
        // optional .env; ignore if missing
    }
    return out;
})();
function popFlag(name, fallback) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return fallback;
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val ?? fallback;
}
function hasFlag(name) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return false;
    args.splice(idx, 1);
    return true;
}
const command = args.shift() ?? '';
const endpoint = popFlag('--endpoint', env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/');
// Group ID: explicit --group > env > folder-based (current directory)
const explicitGroup = popFlag('--group', null);
const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || getCurrentGroupId();
const limit = Number(popFlag('--limit', '20')) || 20;
const status = popFlag('--status', 'todo');
const tag = popFlag('--tag', null);
const repo = popFlag('--repo', path.basename(process.cwd()) || 'unknown');
const assignee = (popFlag('--assignee', process.env.USER || 'unknown') || 'unknown');
const notes = popFlag('--notes', '');
const useCache = hasFlag('--cache');
const payload = args.join(' ').trim();
const cacheFile = path.join(__dirname, '..', 'cache', 'tasks.log');
// Mode detection
const graphitiMode = env.STORAGE_MODE || process.env.STORAGE_MODE || 'local';
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
    if (!resp.ok)
        throw new Error(`initialize failed: ${resp.status}`);
    const sid = resp.headers.get('mcp-session-id');
    if (!sid)
        throw new Error('missing mcp-session-id');
    return sid;
}
async function rpcCall(method, params, sessionId) {
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
        const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine)
            text = dataLine.slice(5).trim();
    }
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (err) {
        throw new Error(`bad JSON: ${text.slice(0, 160)}`);
    }
    if (!resp.ok || data.error)
        throw new Error(data?.error?.message || `HTTP ${resp.status}`);
    return data.result?.structuredContent?.result || data.result || data;
}
// ============================================================================
// MCP Mode Functions (local Docker)
// ============================================================================
async function addTask(sessionId) {
    if (!payload)
        throw new Error('add requires task text (title)');
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
async function updateTask(sessionId) {
    if (!payload)
        throw new Error('update requires task text (title)');
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
function parseTasksFromEpisodes(episodes) {
    return episodes
        .map((e) => {
        const content = e.content || e.episode_body || '';
        let obj = null;
        try {
            obj = JSON.parse(content);
        }
        catch (_) { /* ignore */ }
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
async function listTasks(sessionId) {
    // Use hierarchical groups (current folder + parents) unless explicit group specified
    const groupIds = explicitGroup ? [explicitGroup] : getHierarchicalGroupIds();
    const params = { group_ids: groupIds, max_episodes: limit };
    const result = await rpcCall('get_episodes', params, sessionId);
    const episodes = result?.episodes || result?.result?.episodes || [];
    const tasks = parseTasksFromEpisodes(episodes);
    return { status: 'ok', action: 'list', group: groupId, groups: groupIds, tasks };
}
// ============================================================================
// Zep Cloud Mode Functions (no MCP/Docker required)
// ============================================================================
async function addTaskZep() {
    if (!payload)
        throw new Error('add requires task text (title)');
    if (!zepApiKey)
        throw new Error('ZEP_API_KEY required for zep-cloud mode');
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
    if (!payload)
        throw new Error('update requires task text (title)');
    if (!zepApiKey)
        throw new Error('ZEP_API_KEY required for zep-cloud mode');
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
    if (!zepApiKey)
        throw new Error('ZEP_API_KEY required for zep-cloud mode');
    // Use hierarchical groups (current folder + parents) unless explicit group specified
    const groupIds = explicitGroup ? [explicitGroup] : getHierarchicalGroupIds();
    const messages = await zepGetMessages(zepApiKey, groupIds, limit);
    const tasks = parseTasksFromZepMessages(messages, repo, assignee);
    return {
        status: 'ok',
        action: 'list',
        group: groupId,
        groups: groupIds,
        tasks,
        mode: 'zep-cloud',
    };
}
// ============================================================================
// Cache Functions
// ============================================================================
function writeCache(obj) {
    try {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
        fs.appendFileSync(cacheFile, `${line}\n`, 'utf8');
    }
    catch (err) {
        // ignore cache errors
    }
}
function readCacheFallback() {
    try {
        const data = fs.readFileSync(cacheFile, 'utf8').trim().split('\n').filter(Boolean);
        if (!data.length)
            return null;
        return data.slice(-1).map((l) => JSON.parse(l))[0];
    }
    catch (err) {
        return null;
    }
}
// ============================================================================
// Main
// ============================================================================
async function main() {
    try {
        if (!['add', 'list', 'update'].includes(command))
            throw new Error('command must be add|list|update');
        let out;
        if (isZepCloud) {
            // Zep Cloud mode: use native REST API (no Docker/MCP required)
            out =
                command === 'add'
                    ? await addTaskZep()
                    : command === 'update'
                        ? await updateTaskZep()
                        : await listTasksZep();
        }
        else {
            // MCP mode: local (requires Docker MCP server)
            const sid = await initialize();
            out =
                command === 'add'
                    ? await addTask(sid)
                    : command === 'update'
                        ? await updateTask(sid)
                        : await listTasks(sid);
        }
        if (useCache)
            writeCache(out);
        console.log(JSON.stringify(out, null, 2));
    }
    catch (err) {
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
