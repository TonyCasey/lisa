#!/usr/bin/env node
export {}; // keep scope local for TypeScript

const crypto = require('crypto');
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { buildTags } = require('./common/tags');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { autoFormat } = require('./common/table');

type ParsedArgs = {
  kind: string;
  extra: string[];
  text?: string;
  tool?: string;
  language?: string;
  domain?: string;
  level?: string;
  force?: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = { kind: 'Procedure', extra: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' || args[i] === '-t') out.text = args[++i];
    if (args[i] === '--kind' || args[i] === '-k') out.kind = args[++i];
    if (args[i] === '--tool') out.tool = args[++i];
    if (args[i] === '--language' || args[i] === '-l') out.language = args[++i];
    if (args[i] === '--domain' || args[i] === '-d') out.domain = args[++i];
    if (args[i] === '--level') out.level = args[++i];
    if (args[i] === '--force') out.force = true;
    if (!args[i].startsWith('-') && !args[i - 1]?.startsWith('-')) out.extra.push(args[i]);
  }
  return out;
}

function deriveText({ text, extra }: ParsedArgs) {
  if (text) return text;
  if (process.env.CODEX_LAST_COMMAND) return `Command: ${process.env.CODEX_LAST_COMMAND}`;
  if (extra && extra.length) return extra.join(' ');
  return null;
}

function fingerprint(text: string) {
  return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
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
  const parsed = parseArgs();
  const { kind, tool, language, domain, level, force } = parsed;
  const text = deriveText(parsed);
  if (!text) {
    console.error('after_command requires --text or positional text/COMMAND env');
    process.exit(1);
  }
  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;
  const fp = fingerprint(text);
  const uuid = stableUuid(text);

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const fpTag = `fingerprint:${fp}`;

  const tags = [
    ...buildTags({ tool, language, domain, level, extra: [fpTag] }),
    ...repoTags({ repo, branch }),
  ];

  if (!force) {
    try {
      const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
      const [existing] = await rpcCall('search_nodes', searchParams, sessionId);
      const nodes = existing?.result?.nodes || existing?.nodes || [];
      if (nodes.length) {
        console.log('Duplicate after_command memory detected; skipping (use --force to override).');
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`dedupe search failed: ${message}`);
    }
  }
  const params = {
    name: `${kind}: ${text.substring(0, 64)}`,
    episode_body: text,
    source: 'text',
    kind,
    tags,
    group_id: groupId,
    uuid,
  };
  await rpcCall('add_memory', params, sessionId);
  const storedNode = await waitForPersist({ fp, fpTag, groupId, sessionId });
  const displayId = storedNode?.uuid || uuid;
  const formatted = autoFormat([{ kind, text, id: displayId }]);
  if (storedNode) {
    console.log(formatted || `Stored ${kind} (${displayId}).`);
  } else {
    console.log(formatted || `Queued ${kind} (pending index: ${displayId}).`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
