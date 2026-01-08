#!/usr/bin/env node
export {}; // keep module scoped

const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { autoFormat } = require('./common/table');

type ParsedArgs = { summary?: string };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary' || args[i] === '-s') out.summary = args[++i];
  }
  return out;
}

async function main() {
  const { summary } = parseArgs();
  if (!summary) {
    console.error('session_end requires --summary');
    process.exit(1);
  }
  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });
  const params = {
    name: 'Session summary',
    episode_body: summary,
    source: 'text',
    group_id: groupId,
    tags: repoTags({ repo, branch }),
  };
  await rpcCall('add_memory', params, sessionId);
  const formatted = autoFormat([{ summary }]);
  console.log(formatted || 'Session summary stored');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
