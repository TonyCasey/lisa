#!/usr/bin/env node
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary' || args[i] === '-s') out.summary = args[++i];
    if (args[i] === '--ticket' || args[i] === '-t') out.ticket = args[++i];
    if (args[i] === '--followup' || args[i] === '-f') out.followup = true;
  }
  return out;
}

async function main() {
  const { summary, ticket, followup } = parseArgs();
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
  const followupTag = followup ? ['status:followup'] : [];
  const params = {
    name: ticket ? `Decision for ${ticket}` : 'Session summary',
    episode_body: summary,
    source: 'text',
    group_id: groupId,
    tags: [...repoTags({ repo, branch }), ...followupTag],
  };
  await rpcCall('add_memory', params, sessionId);
  console.log('Session summary stored');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
