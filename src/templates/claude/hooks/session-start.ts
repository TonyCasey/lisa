#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - Session Start Hook
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This ensures Claude has access to prior work, tasks, and project context.
 *
 * Configuration: .claude/settings.json -> hooks.SessionStart
 */

const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { detectRepo, detectBranch, repoTags, getUserName, getProjectAliases } = require('./common/context');

interface MemoryNode {
  uuid?: string;
  name?: string;
  fact?: string;
  tags?: string[];
  created_at?: string;
}

interface MemoryResult {
  result?: {
    facts?: MemoryNode[];
    nodes?: MemoryNode[];
  };
  facts?: MemoryNode[];
  nodes?: MemoryNode[];
}

interface Task {
  key: string;
  status: string;
  title: string;
  blocked: string[];
  created_at?: string;
}

interface TaskCounts {
  ready: number;
  'in-progress': number;
  blocked: number;
  done: number;
  closed: number;
  unknown: number;
  [key: string]: number;
}

function getTaskId(tags: string[] = []): string | null {
  const t = tags.find((x) => x.startsWith('task_id:'));
  return t ? t.replace('task_id:', '') : null;
}

function getTaskNum(tags: string[] = []): string | null {
  const t = tags.find((x) => x.startsWith('task_num:'));
  return t ? t.replace('task_num:', '') : null;
}

function getTaskStatus(tags: string[] = []): string {
  const t = tags.find((x) => x.startsWith('status:'));
  return t ? t.replace('status:', '').toLowerCase() : 'unknown';
}

function pickLatest(a: MemoryNode = {}, b: MemoryNode = {}): MemoryNode {
  const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bd > ad ? b : a;
}

async function main(): Promise<void> {
  // Debug: write to file to verify hook runs
  const fs = require('fs');
  const debugPath = '/tmp/claude-session-start.log';
  fs.appendFileSync(debugPath, `[${new Date().toISOString()}] Session start hook triggered\n`);

  const repo = detectRepo();
  const branch = detectBranch();
  const aliases = getProjectAliases(); // Get all aliases including folder name
  const group = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;
  const user = getUserName();

  let sessionId: string | null = null;
  let facts: MemoryNode[] = [];
  let nodes: MemoryNode[] = [];

  // Load recent facts/nodes from memory (query all aliases)
  try {
    const allFacts: MemoryNode[] = [];
    const seenUuids = new Set<string>();

    // Query facts for each alias to catch memories from renamed projects
    for (const alias of aliases) {
      const baseParams = { query: alias, tags: repoTags({ repo: alias, branch }) };
      const factParams = withGroup({ ...baseParams, max_facts: 50, order: 'desc' }, group);
      const [factResp, sid] = await rpcCall('search_memory_facts', factParams, sessionId) as [MemoryResult, string];
      sessionId = sid;

      const aliasedFacts = factResp?.result?.facts || factResp?.facts || [];
      for (const fact of aliasedFacts) {
        const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
        if (!seenUuids.has(uuid)) {
          seenUuids.add(uuid);
          allFacts.push(fact);
        }
      }
    }
    facts = allFacts;

    // Fall back to nodes if no facts found
    if (!facts.length) {
      for (const alias of aliases) {
        const baseParams = { query: alias, tags: repoTags({ repo: alias, branch }) };
        const nodeParams = withGroup({ ...baseParams, max_nodes: 20 }, group);
        const [nodeResp] = await rpcCall('search_nodes', nodeParams, sessionId) as [MemoryResult, string];
        const aliasedNodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
        for (const node of aliasedNodes) {
          const uuid = node.uuid || `${node.name}-${node.fact}`;
          if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            nodes.push(node);
          }
        }
      }
    }
  } catch (_err) {
    // Silently continue if memory load fails - don't block session start
  }

  // Load tasks for this repo (query all aliases)
  let taskNodes: MemoryNode[] = [];
  try {
    const seenTaskUuids = new Set<string>();

    for (const alias of aliases) {
      const taskParams = withGroup({
        query: 'task',
        tags: ['type:task', ...repoTags({ repo: alias, branch })],
        max_nodes: 200,
      }, group);
      const [taskResp] = await rpcCall('search_nodes', taskParams, sessionId) as [MemoryResult, string];
      const aliasedTasks = taskResp?.result?.nodes || taskResp?.nodes || [];
      for (const task of aliasedTasks) {
        const uuid = task.uuid || `${task.name}-${task.fact}`;
        if (!seenTaskUuids.has(uuid)) {
          seenTaskUuids.add(uuid);
          taskNodes.push(task);
        }
      }
    }
  } catch (_err) {
    // Silently continue if task load fails
  }

  // Process items
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  const items = facts.length ? facts : nodes;
  const recent = items.slice(0, 3).map((n) => n.fact || n.name || n.uuid);

  // Deduplicate tasks by key (task_num or task_id)
  const tasksByKey = new Map<string, MemoryNode>();
  taskNodes.forEach((n) => {
    const key = getTaskNum(n.tags) || getTaskId(n.tags);
    if (!key) return;
    const existing = tasksByKey.get(key);
    const latest = existing ? pickLatest(existing, n) : n;
    tasksByKey.set(key, latest);
  });

  const tasks: Task[] = Array.from(tasksByKey.entries()).map(([key, n]) => {
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

  // Count tasks by status
  const counts: TaskCounts = {
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

  // Build output
  const lines: string[] = [];
  lines.push(`Memory loaded for session start.`);
  lines.push(`User: ${user} | Repo: ${repoLabel}`);

  if (recent.length) {
    lines.push(`Recent context: ${recent.join(' | ')}`);
  }

  if (tasks.length) {
    const summaryParts: string[] = [];
    if (counts['in-progress']) summaryParts.push(`${counts['in-progress']} in-progress`);
    if (counts.ready) summaryParts.push(`${counts.ready} ready`);
    if (counts.blocked) summaryParts.push(`${counts.blocked} blocked`);
    if (counts.done) summaryParts.push(`${counts.done} done`);
    if (counts.closed) summaryParts.push(`${counts.closed} closed`);
    lines.push(`Tasks: ${summaryParts.join(', ') || 'none active'}`);

    if (active.length) {
      lines.push(`Active: ${active[0].key} - ${active[0].title}`);
    }
    if (ready.length) {
      const readyList = ready.slice(0, 2).map((t) => `${t.key} - ${t.title}`).join(' | ');
      lines.push(`Ready: ${readyList}`);
    }
  } else {
    lines.push('Tasks: none found for this repo');
  }

  // Output goes to Claude as system-reminder context (stdout)
  console.log(lines.join('\n'));

  // Visible confirmation to user (stderr) - brief summary
  const itemCount = items.length;
  const taskCount = tasks.length;
  const summary = itemCount || taskCount
    ? `${itemCount} memories, ${taskCount} tasks`
    : 'no prior context';
  console.error(`[Memory loaded: ${summary}]`);
}

main().catch((err: Error) => {
  // Don't block session start on errors - just log and exit cleanly
  console.log(`Memory load skipped: ${err.message}`);
  process.exit(0);
});
