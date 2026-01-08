#!/usr/bin/env node
export {}; // keep scope local

const crypto = require('crypto');
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { buildTags } = require('./common/tags');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { autoFormat } = require('./common/table');

type ParsedArgs = {
  text?: string;
  role?: string;
  kind?: string;
  language?: string;
  tool?: string;
  domain?: string;
  level?: string;
  force?: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = { role: 'user' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' || args[i] === '-t') out.text = args[++i];
    if (args[i] === '--role' || args[i] === '-r') out.role = args[++i];
    if (args[i] === '--kind' || args[i] === '-k') out.kind = args[++i];
    if (args[i] === '--language' || args[i] === '-l') out.language = args[++i];
    if (args[i] === '--tool') out.tool = args[++i];
    if (args[i] === '--domain' || args[i] === '-d') out.domain = args[++i];
    if (args[i] === '--level') out.level = args[++i];
    if (args[i] === '--force') out.force = true;
  }
  return out;
}

function classifyKind(text: string = '', role: string = 'user') {
  const lower = text.toLowerCase();
  if (lower.includes('must') || lower.includes('require') || lower.includes('acceptance')) return 'Requirement';
  if (lower.includes('decision') || lower.includes('decide') || lower.includes('we will') || lower.includes("let's")) return 'Decision';
  if (lower.includes('should') || lower.includes('let\'s plan') || lower.includes('next step')) return 'Direction';
  if (role === 'assistant') return 'Observation';
  return 'Direction';
}

function fingerprint(text: string) {
  return crypto.createHash('sha1').update(text.trim()).digest('hex');
}

function stableUuid(text: string) {
  const hex = crypto.createHash('sha1').update(text.trim()).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPersist({
  fp,
  fpTag,
  groupId,
  sessionId,
  attempts = 5,
  baseDelay = 150,
}: {
  fp: string;
  fpTag: string;
  groupId: string;
  sessionId: string;
  attempts?: number;
  baseDelay?: number;
}) {
  for (let i = 0; i < attempts; i++) {
    const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
    const [existing] = await rpcCall('search_nodes', searchParams, sessionId);
    const nodes = existing?.result?.nodes || existing?.nodes || [];
    if (nodes.length) return nodes[0];
    await sleep(baseDelay * (i + 1));
  }
  return null;
}

async function main() {
  const { text, role = 'user', kind: kindArg, language, tool, domain, level, force } = parseArgs();
  if (!text) {
    console.error('per_prompt requires --text');
    process.exit(1);
  }

  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;
  const kind = kindArg || classifyKind(text, role);
  const fp = fingerprint(text).slice(0, 16);
  const uuid = stableUuid(text);

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const fpTag = `fingerprint:${fp}`;
  const tags = [
    ...buildTags({ language, tool, domain, level, lifecycle: 'prompt', extra: [fpTag, `role:${role}`, `kind:${kind.toLowerCase()}`] }),
    ...repoTags({ repo, branch }),
  ];

  if (!force) {
    try {
      const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
      const [existing] = await rpcCall('search_nodes', searchParams, sessionId);
      const nodes = existing?.result?.nodes || existing?.nodes || [];
      if (nodes.length) {
        console.log('Duplicate prompt memory detected; skipping (use --force to override).');
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`dedupe search failed: ${message}`);
    }
  }

  const body = {
    role,
    kind,
    text,
    repo,
    branch,
    language,
    tool,
    domain,
    level,
    captured_at: new Date().toISOString(),
  };

  const params = {
    name: `${kind}: ${text.substring(0, 80)}`,
    episode_body: JSON.stringify(body),
    source: 'json',
    group_id: groupId,
    uuid,
    tags,
  };

  await rpcCall('add_memory', params, sessionId);
  const storedNode = await waitForPersist({ fp, fpTag, groupId, sessionId });
  const displayId = storedNode?.uuid || uuid;
  const formatted = autoFormat([{ kind, role, text, id: displayId }]);
  if (storedNode) {
    console.log(formatted || `Stored ${kind} (${displayId}) from ${role} prompt.`);
  } else {
    console.log(formatted || `Queued ${kind} from ${role} prompt (pending index: ${displayId}).`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
