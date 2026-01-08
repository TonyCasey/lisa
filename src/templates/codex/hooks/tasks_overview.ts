#!/usr/bin/env node
export {}; // keep module scoped
// Table overview of tasks for current repo/branch grouped by task_id.
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

type TaskNode = {
  tags?: string[];
  name?: string;
  fact?: string;
  episode_body?: { text?: string };
  created_at?: string;
};

type Row = { id: string; num: string | null; status: string; title: string; blocked: string[]; created_at?: string };

function getTaskId(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('task_id:'));
  return t ? t.replace('task_id:', '') : null;
}

function getTaskNum(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('task_num:'));
  return t ? t.replace('task_num:', '') : null;
}

function getStatus(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('status:'));
  return t ? t.replace('status:', '') : 'unknown';
}

function pickLatest(a: TaskNode, b: TaskNode) {
  const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bd > ad ? b : a;
}

async function main() {
  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const tags = ['type:task', ...repoTags({ repo, branch })];

  const params = withGroup({ query: 'task', tags, max_nodes: 200 }, groupId);
  const [resp] = await rpcCall('search_nodes', params, sessionId);
  const nodes = resp?.result?.nodes || resp?.nodes || [];

  if (!nodes.length) {
    console.log('No tasks found for this repo.');
    return;
  }

  const byKey = new Map<string, TaskNode>();
  nodes.forEach((n: TaskNode) => {
    const num = getTaskNum(n.tags || []);
    const id = getTaskId(n.tags || []) || num;
    if (!id) return;
    const existing = byKey.get(id);
    const latest = existing ? pickLatest(existing, n) : n;
    byKey.set(id, latest);
  });

  const rows: Row[] = Array.from(byKey.entries()).map(([id, n]) => {
    const status = getStatus(n.tags || []);
    const title = n.name || n.fact || (n.episode_body && n.episode_body.text) || '<untitled>';
    const blocked = (n.tags || []).filter((t) => t.startsWith('blocked_by:')).map((t) => t.replace('blocked_by:', ''));
    const num = getTaskNum(n.tags || []);
    return { id, num, status, title, blocked, created_at: n.created_at };
  });

  rows.sort((a, b) => {
    const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bd - ad;
  });

  const pad = (s: string, len: number) => (s.length >= len ? s.slice(0, len - 1) + '…' : s.padEnd(len, ' '));
  console.log(pad('ID/NUM', 14), pad('STATUS', 14), 'TITLE');
  rows.forEach((r) => {
    const blocked = r.blocked.length ? ` [blocked by ${r.blocked.join(',')}]` : '';
    const key = r.num ? `${r.num}/${r.id}` : r.id;
    console.log(pad(key, 14), pad(r.status, 14), `${r.title}${blocked}`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
