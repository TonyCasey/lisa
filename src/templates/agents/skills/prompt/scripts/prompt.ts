#!/usr/bin/env node
/**
 * Prompt Capture Skill
 *
 * Stores user prompts as episodes in Graphiti MCP.
 * Graphiti's LLM automatically classifies entities as:
 * - KeyDecision: Major decisions about approach/strategy
 * - DirectionChange: Changes in strategy or pivots
 * - ArchitecturalChoice: Technical/architectural decisions
 * - Preference: User preferences and style choices
 * - Requirement: Specific needs that must be fulfilled
 *
 * The classification happens server-side based on entity_types in config.yaml
 */

export {}; // keep module scope local

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

type Args = {
  text?: string;
  role?: string;
  source?: string;  // e.g., 'user-prompt', 'assistant-response', 'code-change'
  force?: boolean;
};

const args = process.argv.slice(2);

function popFlag(name: string, fallback: string | boolean): any {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const val = args[idx + 1];
  args.splice(idx, 2);
  if (typeof fallback === 'boolean') return true;
  return val ?? fallback;
}
function hasFlag(name: string) {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

const envPath = path.join(__dirname, '..', '..', '.env');
const env: Record<string, string> = {};
try {
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line: string) => {
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
} catch (_) {
  /* optional */
}

const endpoint = popFlag('--endpoint', env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/');
const groupId = popFlag('--group', env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || 'lisa');
const force = hasFlag('--force') || popFlag('--force', false);

function parseArgs(): Args {
  const out: Args = { role: 'user', source: 'user-prompt' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' || args[i] === '-t') out.text = args[++i];
    if (args[i] === '--role' || args[i] === '-r') out.role = args[++i];
    if (args[i] === '--source' || args[i] === '-s') out.source = args[++i];
    // Legacy support for --kind (now ignored - Graphiti classifies automatically)
    if (args[i] === '--kind' || args[i] === '-k') args[++i]; // skip
  }
  return out;
}

function fingerprint(text: string) {
  return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
}

async function initialize() {
  const body = {
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: { experimental: {}, prompts: { listChanged: false }, resources: { subscribe: false, listChanged: false }, tools: { listChanged: false } },
      clientInfo: { name: 'prompt-skill', version: '0.1.0' },
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
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine) text = dataLine.slice(5).trim();
  }
  const data = JSON.parse(text);
  if (!resp.ok || data.error) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  return data.result?.structuredContent?.result || data.result || data;
}

async function addPrompt() {
  const { text, role = 'user', source = 'user-prompt' } = parseArgs();
  if (!text) throw new Error('prompt requires --text');
  const fp = fingerprint(text);
  const fpTag = `fingerprint:${fp}`;

  const sid = await initialize();

  if (!force) {
    try {
      const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
      const existing = await rpcCall('search_nodes', searchParams, sid);
      const nodes = existing?.result?.nodes || existing?.nodes || [];
      if (nodes.length) {
        console.log('Duplicate prompt; skipping (use --force to override).');
        return { status: 'skipped', reason: 'duplicate' };
      }
    } catch (_) {
      // ignore dedupe errors
    }
  }

  // Let Graphiti's LLM classify the content automatically based on entity_types config
  // We just provide the raw text - classification happens server-side
  const params = {
    name: text.substring(0, 100),
    episode_body: text,  // Pass raw text for better LLM classification
    source: source,      // Track where this came from
    group_id: groupId,
    tags: [fpTag, `role:${role}`, `source:${source}`],
  };

  await rpcCall('add_memory', params, sid);
  return { status: 'ok', action: 'add', group: groupId, role, source };
}

async function main() {
  try {
    const result = await addPrompt();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

main();
