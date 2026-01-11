#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureUser, recordUserWork, getUserName } = require('./common/user');
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { detectRepo, detectBranch, repoTags } = require('./common/context');

function getTaskId(tags = []) {
  const t = tags.find((x) => x.startsWith('task_id:'));
  return t ? t.replace('task_id:', '') : null;
}

function getTaskNum(tags = []) {
  const t = tags.find((x) => x.startsWith('task_num:'));
  return t ? t.replace('task_num:', '') : null;
}

function getTaskStatus(tags = []) {
  const t = tags.find((x) => x.startsWith('status:'));
  return t ? t.replace('status:', '').toLowerCase() : 'unknown';
}

function pickLatest(a = {}, b = {}) {
  const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bd > ad ? b : a;
}

async function main() {
  const repo = detectRepo();
  const branch = detectBranch();
  const group = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  const [, sid] = await ensureUser(null, group);
  sessionId = sid;
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId: group, sessionId });

  let nodes = [];
  let facts = [];
  try {
    const baseParams = { query: repo, tags: repoTags({ repo, branch }) };

    // Prefer recent facts; fall back to nodes if unavailable.
    const factParams = withGroup({ ...baseParams, max_facts: 50, order: 'desc' }, group);
    const [factResp] = await rpcCall('search_memory_facts', factParams, sessionId);
    facts = factResp?.result?.facts || factResp?.facts || [];

    if (!facts.length) {
      const nodeParams = withGroup({ ...baseParams, max_nodes: 20 }, group);
      const [nodeResp] = await rpcCall('search_nodes', nodeParams, sessionId);
      nodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
      console.log(`Loaded ${nodes.length} prior items for ${repo}${branch ? ' (' + branch + ')' : ''}.`);
    } else {
      console.log(`Loaded ${facts.length} prior items for ${repo}${branch ? ' (' + branch + ')' : ''}.`);
    }
  } catch (err) {
    console.warn(`search_nodes failed: ${err.message}`);
  }

  let taskNodes = [];
  try {
    const taskParams = withGroup({
      query: 'task',
      tags: ['type:task', ...repoTags({ repo, branch })],
      max_nodes: 200,
    }, group);
    const [taskResp] = await rpcCall('search_nodes', taskParams, sessionId);
    taskNodes = taskResp?.result?.nodes || taskResp?.nodes || [];
  } catch (err) {
    console.warn(`task lookup failed: ${err.message}`);
  }

  const user = getUserName();
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  const items = facts.length ? facts : nodes;
  const recent = items.slice(0, 3).map((n) => n.fact || n.name || n.uuid);

  const tasksByKey = new Map();
  taskNodes.forEach((n) => {
    const key = getTaskNum(n.tags) || getTaskId(n.tags);
    if (!key) return;
    const existing = tasksByKey.get(key);
    const latest = existing ? pickLatest(existing, n) : n;
    tasksByKey.set(key, latest);
  });

  const tasks = Array.from(tasksByKey.entries()).map(([key, n]) => {
    const status = getTaskStatus(n.tags);
    const title = n.name || n.fact || n.uuid || '<untitled>';
    const blocked = (n.tags || []).filter((t) => t.startsWith('blocked_by:')).map((t) => t.replace('blocked_by:', ''));
    return { key, status, title, blocked, created_at: n.created_at };
  });

  tasks.sort((a, b) => {
    const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bd - ad;
  });

  const counts = {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
  };
  tasks.forEach((t) => {
    const key = counts[t.status] === undefined ? 'unknown' : t.status;
    counts[key] += 1;
  });

  const active = tasks.filter((t) => t.status === 'in-progress');
  const ready = tasks.filter((t) => t.status === 'ready');

  const lines = [];
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
