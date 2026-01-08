#!/usr/bin/env node
export {}; // avoid global pollution

const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { buildTags } = require('./common/tags');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { autoFormat, formatTable } = require('./common/table');

type ParsedArgs = { command?: string; tool?: string; language?: string };
type Node = { name?: string; fact?: string; uuid?: string };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = {};
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
  const formatted = autoFormat(nodes);
  if (formatted) {
    console.log(formatted);
  } else {
    const headers = ['#', 'Name'];
    const rows = (nodes as Node[]).map((n, idx: number) => [idx + 1, n.name || n.fact || n.uuid]);
    console.log(formatTable({ headers, rows }));
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
