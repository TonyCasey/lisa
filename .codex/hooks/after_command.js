#!/usr/bin/env node
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { buildTags } = require('./common/tags');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const crypto = require('crypto');
const { autoFormat } = require('./common/table');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { kind: 'Procedure' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' || args[i] === '-t') out.text = args[++i];
    if (args[i] === '--kind' || args[i] === '-k') out.kind = args[++i];
    if (args[i] === '--tool') out.tool = args[++i];
    if (args[i] === '--language' || args[i] === '-l') out.language = args[++i];
    if (args[i] === '--domain' || args[i] === '-d') out.domain = args[++i];
    if (args[i] === '--level') out.level = args[++i];
    if (args[i] === '--followup' || args[i] === '-f') out.followup = true;
  }
  return out;
}

function fingerprint(text) {
  return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
}

function stableUuid(text) {
  const hex = crypto.createHash('sha1').update(text.trim()).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPersist({ fp, fpTag, groupId, sessionId, attempts = 5, baseDelay = 150 }) {
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
  const { text, kind, tool, language, domain, level, followup } = parseArgs();
  if (!text) {
    console.error('after_command requires --text');
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

  const followupTag = followup ? ['status:followup'] : [];
  const tags = [
    ...buildTags({ tool, language, domain, level, extra: [`fingerprint:${fp}`, ...followupTag] }),
    ...repoTags({ repo, branch }),
  ];
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
  const storedNode = await waitForPersist({ fp, fpTag: `fingerprint:${fp}`, groupId, sessionId });
  const displayId = storedNode?.uuid || uuid;
  const formatted = autoFormat([{ kind, text, id: displayId }]);
  if (storedNode) {
    console.log(formatted || `Stored ${kind} (${displayId}).`);
  } else {
    console.log(formatted || `Queued ${kind} (pending index: ${displayId}).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
