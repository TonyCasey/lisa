#!/usr/bin/env node
export {}; // keep module scope isolated
// Lists "ready" tasks for the current repo using task graph tags.
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

type TaskNode = {
  tags?: string[];
  created_at?: string;
  name?: string;
  fact?: string;
  uuid?: string;
};

function isReadyTask(node: TaskNode) {
  const tags = node.tags || [];
  const status = tags.find((t) => t.startsWith('status:')) || '';
  const blockedBy = tags.filter((t) => t.startsWith('blocked_by:'));
  if (status === 'status:done' || status === 'status:closed') return false;
  if (blockedBy.length && status !== 'status:ready') return false;
  return true;
}

async function main() {
  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const tags = ['type:task', ...repoTags({ repo, branch })];
  try {
    const params = withGroup({ query: 'task', tags, max_nodes: 100 }, groupId);
    const [resp] = await rpcCall('search_nodes', params, sessionId);
    const nodes = resp?.result?.nodes || resp?.nodes || [];
    const ready = nodes.filter(isReadyTask);

    if (!ready.length) {
      console.log('No ready tasks found (type:task) for this repo.');
      return;
    }

    const sorted = ready.sort((a: TaskNode, b: TaskNode) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });

    console.log('Ready tasks:');
    sorted.forEach((n: TaskNode) => {
      const tagsStr = (n.tags || []).filter((t: string) => t.startsWith('status:') || t.startsWith('blocked_by:')).join(' ');
      const name = n.name || n.fact || n.uuid || '<unnamed>';
      console.log(`- ${name}${tagsStr ? ` (${tagsStr})` : ''}`);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`tasks_ready failed: ${message}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
