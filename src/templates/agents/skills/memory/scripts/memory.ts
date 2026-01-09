#!/usr/bin/env node
// Lightweight Graphiti memory helper usable by any model.
// Commands:
//   node memory.js add "text to remember" [--group <id>] [--tag foo] [--type <type>] [--source <src>] [--cache]
//   node memory.js load [--group <id>] [--query <q>] [--limit N] [--cache]
// Options:
//   --endpoint <url> : MCP endpoint (default env GRAPHITI_ENDPOINT or http://localhost:8010/mcp/)
//   --type <type>    : Entity type (decision, pattern, bug, etc.) - maps to tag
//   --cache          : write successful responses to cache/memory.log and use it as fallback on errors.

export {}; // ensure module scope to prevent global collisions across templates

const fs = require('fs');
const path = require('path');

// Entity type to tag mapping
const TYPE_MAP: Record<string, string> = {
  // Code & Architecture
  'decision': 'code:decision',
  'pattern': 'code:pattern',
  'dependency': 'code:dependency',
  'tech-debt': 'code:tech-debt',
  // Context & History
  'bug': 'context:bug',
  'rationale': 'context:rationale',
  'failed': 'context:failed',
  'quirk': 'context:quirk',
  // External
  'feedback': 'external:feedback',
  'incident': 'external:incident',
  'contract': 'external:contract',
  // People & Process
  'contributor': 'people:contributor',
  'review': 'people:review',
  'blocker': 'people:blocker',
  'estimate': 'people:estimate',
  // Project
  'scope-in': 'project:scope-in',
  'scope-out': 'project:scope-out',
  'milestone': 'project:milestone',
};

// Auto-detect prefixes in text
const PREFIX_MAP: Record<string, string> = {
  'DECISION:': 'code:decision',
  'PATTERN:': 'code:pattern',
  'TECH-DEBT:': 'code:tech-debt',
  'BUG:': 'context:bug',
  'RATIONALE:': 'context:rationale',
  'FAILED:': 'context:failed',
  'INCIDENT:': 'external:incident',
  'BLOCKER:': 'people:blocker',
  'SCOPE-IN:': 'project:scope-in',
  'SCOPE-OUT:': 'project:scope-out',
};

function detectPrefixTag(text: string): string | null {
  for (const [prefix, tag] of Object.entries(PREFIX_MAP)) {
    if (text.toUpperCase().startsWith(prefix)) {
      return tag;
    }
  }
  return null;
}

const args: string[] = process.argv.slice(2);
const env = (() => {
  // Read from .agents/.env (3 levels up from scripts/memory/scripts/)
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
const query = popFlag('--query', '');
const limit = Number(popFlag('--limit', '10')) || 10;
const explicitTag = popFlag('--tag', null);
const entityType = popFlag('--type', null);
const source = popFlag('--source', 'skill:load-memory');
const useCache = hasFlag('--cache');
const payload = args.join(' ').trim();
const cacheFile = path.join(__dirname, '..', 'cache', 'memory.log');

// Resolve tag: explicit --tag > --type mapping > prefix detection > undefined
function resolveTag(text: string): string | undefined {
  if (explicitTag) return explicitTag;
  if (entityType && TYPE_MAP[entityType]) return TYPE_MAP[entityType];
  const prefixTag = detectPrefixTag(text);
  if (prefixTag) return prefixTag;
  return undefined;
}

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
      clientInfo: { name: 'memory-skill', version: '0.1.0' },
    },
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Graphiti requires clients to accept both JSON responses and event streams.
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`initialize failed: ${resp.status}`);
  const sid = resp.headers.get('mcp-session-id');
  if (!sid) throw new Error('missing mcp-session-id');
  return sid;
}

async function rpcCall(method: string, params: unknown, sessionId: string) {
  const payload =
    method === 'initialize' || method === 'ping' || method.startsWith('tools/')
      ? { jsonrpc: '2.0', id: '1', method, params }
      : { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: method, arguments: params } };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'MCP-SESSION-ID': sessionId,
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
  });
  let text = await resp.text();
  // MCP servers may wrap JSON in Server-Sent Events; unwrap the data line if present.
  if (text.startsWith('event:')) {
    const dataLine = text.split('\n').find((l: string) => l.startsWith('data:'));
    if (dataLine) text = dataLine.slice(5).trim();
  }
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(`bad JSON: ${text.slice(0, 160)}`); }
  if (!resp.ok || data.error) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  return data.result?.structuredContent?.result || data.result || data;
}

async function addMemory(sessionId: string) {
  if (!payload) throw new Error('add requires text payload');
  const resolvedTag = resolveTag(payload);
  const params = {
    name: payload.slice(0, 80),
    episode_body: payload,
    source,
    group_id: groupId,
    tags: resolvedTag ? [resolvedTag] : undefined,
  };
  await rpcCall('add_memory', params, sessionId);
  return { status: 'ok', action: 'add', group: groupId, text: payload, tag: resolvedTag };
}

async function loadMemory(sessionId: string) {
  const params = { query: query || '*', max_facts: limit, group_ids: [groupId] };
  const result = await rpcCall('search_memory_facts', params, sessionId);
  const facts = result?.facts || result?.result?.facts || [];
  return { status: 'ok', action: 'load', group: groupId, query, facts };
}

function writeCache(obj: Record<string, unknown>) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
    fs.appendFileSync(cacheFile, `${line}\n`, 'utf8');
  } catch (err: unknown) {
    // cache failures should not crash command
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

async function main() {
  try {
    if (!['add', 'load'].includes(command)) throw new Error('command must be add|load');
    const sid = await initialize();
    const out = command === 'add' ? await addMemory(sid) : await loadMemory(sid);
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
