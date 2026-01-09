#!/usr/bin/env node
export {}; // keep scope local

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureUser, recordUserWork, getUserName } = require('./common/user');
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

type TaskNode = {
  tags?: string[];
  name?: string;
  fact?: string;
  uuid?: string;
  created_at?: string;
};

type TaskSummary = { key: string; status: string; title: string; blocked: string[]; created_at?: string };

function hasLisaInstalled(projectRoot: string) {
  try {
    require.resolve('lisa/package.json', { paths: [projectRoot] });
    return true;
  } catch (_err) {
    return false;
  }
}

function ensureLisa(projectRoot: string) {
  const codexDir = path.join(projectRoot, '.codex');
  if (fs.existsSync(codexDir)) return;
  if (hasLisaInstalled(projectRoot)) return;

  const localTarballPath = '/Users/tony.casey/Repos/lisa/dist';
  if (!fs.existsSync(localTarballPath)) {
    console.warn('lisa auto-install skipped: local dist not found at /Users/tony.casey/Repos/lisa/dist');
    return;
  }

  try {
    console.log('No .codex detected; installing lisa from local dist...');
    execSync(`npm install --save-dev ${localTarballPath}`, { cwd: projectRoot, stdio: 'inherit' });
    console.log('lisa installed locally. Run `npx lisa setup` to scaffold hooks.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`lisa auto-install failed: ${message}`);
  }
}

function getTaskId(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('task_id:'));
  return t ? t.replace('task_id:', '') : null;
}

function getTaskNum(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('task_num:'));
  return t ? t.replace('task_num:', '') : null;
}

function getTaskStatus(tags: string[] = []) {
  const t = tags.find((x) => x.startsWith('status:'));
  return t ? t.replace('status:', '').toLowerCase() : 'unknown';
}

function pickLatest(a: TaskNode, b: TaskNode) {
  const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bd > ad ? b : a;
}

async function main() {
  const repo = detectRepo();
  const branch = detectBranch();
  const group = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  ensureLisa(process.cwd());

  let sessionId = null;
  const [, sid] = await ensureUser(null, group);
  sessionId = sid;
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId: group, sessionId });

  let nodes: TaskNode[] = [];
  try {
    const params = withGroup({
      query: repo,
      tags: repoTags({ repo, branch }),
      max_nodes: 20,
    }, group);
    const [resp] = await rpcCall('search_nodes', params, sessionId);
    nodes = resp?.result?.nodes || resp?.nodes || [];
    console.log(`Loaded ${nodes.length} prior items for ${repo}${branch ? ' (' + branch + ')' : ''}.`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`search_nodes failed: ${message}`);
  }

  let taskNodes: TaskNode[] = [];
  try {
    const taskParams = withGroup({
      query: 'task',
      tags: ['type:task', ...repoTags({ repo, branch })],
      max_nodes: 200,
    }, group);
    const [taskResp] = await rpcCall('search_nodes', taskParams, sessionId);
    taskNodes = taskResp?.result?.nodes || taskResp?.nodes || [];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`task lookup failed: ${message}`);
  }

  const user = getUserName();
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  const recent = nodes.slice(0, 3).map((n) => n.name || n.fact || n.uuid);

  const tasksByKey = new Map<string, TaskNode>();
  taskNodes.forEach((n: TaskNode) => {
    const key = getTaskNum(n.tags || []) || getTaskId(n.tags || []);
    if (!key) return;
    const existing = tasksByKey.get(key);
    const latest = existing ? pickLatest(existing, n) : n;
    tasksByKey.set(key, latest);
  });

  const tasks: TaskSummary[] = Array.from(tasksByKey.entries()).map(([key, n]) => {
    const status = getTaskStatus(n.tags || []);
    const title = n.name || n.fact || n.uuid || '<untitled>';
    const blocked = (n.tags || []).filter((t) => t.startsWith('blocked_by:')).map((t) => t.replace('blocked_by:', ''));
    return { key, status, title, blocked, created_at: n.created_at };
  });

  tasks.sort((a: TaskSummary, b: TaskSummary) => {
    const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bd - ad;
  });

  const counts: Record<string, number> = {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
  };
  tasks.forEach((t: TaskSummary) => {
    const key = counts[t.status] === undefined ? 'unknown' : t.status;
    counts[key] += 1;
  });

  const active = tasks.filter((t) => t.status === 'in-progress');
  const ready = tasks.filter((t) => t.status === 'ready');

  const lines: string[] = [];
  lines.push(`User: ${user} · Repo: ${repoLabel}`);
  if (recent.length) {
    lines.push(`Recent: ${recent.join(' · ')}`);
  } else {
    lines.push('Recent: none');
  }

  if (tasks.length) {
    const summaryParts = [];
    if (counts['in-progress']) summaryParts.push(`${counts['in-progress']} in-progress`);
    if (counts.ready) summaryParts.push(`${counts.ready} ready`);
    if (counts.blocked) summaryParts.push(`${counts.blocked} blocked`);
    if (counts.done) summaryParts.push(`${counts.done} done`);
    if (counts.closed) summaryParts.push(`${counts.closed} closed`);
    if (counts.unknown) summaryParts.push(`${counts.unknown} unknown`);
    lines.push(`Tasks: ${summaryParts.join(', ')}`);
    if (active.length) {
      lines.push(`Active: ${active[0].key} ${active[0].title}`);
    }
    if (ready.length) {
      const readyList = ready.slice(0, 3).map((t) => `${t.key} ${t.title}`).join(' · ');
      lines.push(`Ready: ${readyList}`);
    }
  } else {
    lines.push('Tasks: none found for this repo.');
  }

  console.log(lines.join('\n'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
