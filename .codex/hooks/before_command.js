#!/usr/bin/env node
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { buildTags } = require('./common/tags');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--command' || args[i] === '-c') out.command = args[++i];
    if (args[i] === '--tool' || args[i] === '-t') out.tool = args[++i];
    if (args[i] === '--language' || args[i] === '-l') out.language = args[++i];
  }
  return out;
}

async function main() {
  const { command, tool, language } = parseArgs();
  const query = command || tool || language;
  if (!query) {
    console.error('before_command requires --command, --tool, or --language');
    process.exit(1);
  }
  const repo = detectRepo();
  const branch = detectBranch();
  const group = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  [, sessionId] = await ensureUser(null, group);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId: group, sessionId });

  const tags = [
    ...buildTags({ tool, language }),
    ...repoTags({ repo, branch }),
  ];
  const params = withGroup({ query, tags, max_nodes: 15 }, group);
  const [resp] = await rpcCall('search_nodes', params, sessionId);
  const nodes = resp?.result?.nodes || resp?.nodes || [];
  if (!nodes.length) {
    console.log('No prior rules found.');
    return;
  }
  console.log('Relevant rules:');
  nodes.forEach((n, idx) => {
    const name = n.name || n.fact || n.uuid;
    console.log(`${idx + 1}. ${name}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
