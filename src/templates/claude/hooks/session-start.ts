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

// Configuration for recent memories display
const RECENT_HOURS = 24;
const MAX_RECENT_MEMORIES = 5;

// Low-level relationship types to exclude (system noise, not meaningful work)
const EXCLUDED_RELATIONSHIPS = new Set([
  // System/debug noise
  'USER_SUBMITS_DIRECTION', 'DIRECTION_IS_TOPIC',
  'EXPANDED_ENTITY_TYPES_TRACKED',
  // Overly granular
  'TESTS', 'ASSESSES',
]);

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

/**
 * Filter memories to meaningful ones from the last N hours (excludes noise)
 */
function filterRecentMemories(memories: MemoryNode[], hoursAgo: number = RECENT_HOURS): MemoryNode[] {
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return memories.filter((m) => {
    // Must have timestamp
    if (!m.created_at) return false;
    const created = new Date(m.created_at);
    if (created < cutoff) return false;

    // Exclude known noise relationship types
    if (m.name && EXCLUDED_RELATIONSHIPS.has(m.name)) {
      return false;
    }

    return true;
  });
}

/**
 * Format a date relative to now (today, yesterday, or date)
 */
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${time}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  } else {
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${month} ${day} ${time}`;
  }
}

// Time window for grouping memories (in minutes)
const GROUP_WINDOW_MINUTES = 5;

interface MemoryGroup {
  timestamp: Date;
  memories: MemoryNode[];
  summary: string;
}

/**
 * Extract common theme from a group of memory facts
 */
function extractGroupSummary(memories: MemoryNode[]): string {
  if (memories.length === 1) {
    return memories[0].fact || memories[0].name || '<unknown>';
  }

  // Get all fact texts
  const facts = memories.map((m) => m.fact || m.name || '').filter(Boolean);
  if (!facts.length) return `${memories.length} items`;

  // Find common prefix/theme by looking for repeated phrases
  const words = facts[0].split(/\s+/);
  let commonPrefix = '';

  // Find longest common prefix of words
  for (let i = 0; i < Math.min(words.length, 8); i++) {
    const prefix = words.slice(0, i + 1).join(' ');
    const allMatch = facts.every((f) => f.startsWith(prefix));
    if (allMatch) {
      commonPrefix = prefix;
    } else {
      break;
    }
  }

  // Clean up the prefix (remove trailing articles, prepositions)
  commonPrefix = commonPrefix.replace(/\s+(the|a|an|is|are|was|were|includes?|has|have|with|for|to|of|in|on|at)$/i, '');

  if (commonPrefix.length > 15) {
    return `${commonPrefix} (${memories.length} items)`;
  }

  // Fallback: use first fact truncated
  const firstFact = facts[0];
  if (firstFact.length > 60) {
    return `${firstFact.slice(0, 57)}... (+${memories.length - 1} more)`;
  }
  return `${firstFact} (+${memories.length - 1} more)`;
}

/**
 * Group memories by time window and create summaries
 */
function groupMemoriesByTime(memories: MemoryNode[], windowMinutes: number = GROUP_WINDOW_MINUTES): MemoryGroup[] {
  if (!memories.length) return [];

  // Sort by created_at descending (most recent first)
  const sorted = [...memories].sort((a, b) => {
    const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bd - ad;
  });

  const groups: MemoryGroup[] = [];
  let currentGroup: MemoryNode[] = [];
  let groupStartTime: number | null = null;

  for (const memory of sorted) {
    const memTime = memory.created_at ? new Date(memory.created_at).getTime() : 0;

    if (groupStartTime === null) {
      // Start new group
      groupStartTime = memTime;
      currentGroup = [memory];
    } else if (groupStartTime - memTime <= windowMinutes * 60 * 1000) {
      // Within window, add to current group
      currentGroup.push(memory);
    } else {
      // Outside window, save current group and start new one
      groups.push({
        timestamp: new Date(groupStartTime),
        memories: currentGroup,
        summary: extractGroupSummary(currentGroup),
      });
      groupStartTime = memTime;
      currentGroup = [memory];
    }
  }

  // Don't forget the last group
  if (currentGroup.length && groupStartTime !== null) {
    groups.push({
      timestamp: new Date(groupStartTime),
      memories: currentGroup,
      summary: extractGroupSummary(currentGroup),
    });
  }

  return groups;
}

/**
 * Format memory groups as summary lines with relative dates
 * Grouped by time, limited to max groups
 */
function formatMemorySummary(memories: MemoryNode[], limit: number = MAX_RECENT_MEMORIES): string[] {
  const groups = groupMemoriesByTime(memories);

  // Take top N groups
  const topGroups = groups.slice(0, limit);

  // Format each group
  return topGroups.map((group) => {
    const dateStr = formatRelativeDate(group.timestamp);
    return `  ${dateStr} - ${group.summary}`;
  });
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

  // Load recent facts/nodes from memory
  try {
    const allFacts: MemoryNode[] = [];
    const seenUuids = new Set<string>();

    // First: Query ALL recent facts in the group (no repo tag filter)
    // This catches memories that weren't tagged with a specific repo
    const recentParams = withGroup({ query: '*', max_facts: 100, order: 'desc' }, group);
    const [recentResp, sid] = await rpcCall('search_memory_facts', recentParams, sessionId) as [MemoryResult, string];
    sessionId = sid;

    const recentFacts = recentResp?.result?.facts || recentResp?.facts || [];
    for (const fact of recentFacts) {
      const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
      if (!seenUuids.has(uuid)) {
        seenUuids.add(uuid);
        allFacts.push(fact);
      }
    }

    // Also query by repo aliases to catch any repo-specific memories
    for (const alias of aliases) {
      const baseParams = { query: alias, tags: repoTags({ repo: alias, branch }) };
      const factParams = withGroup({ ...baseParams, max_facts: 50, order: 'desc' }, group);
      const [factResp] = await rpcCall('search_memory_facts', factParams, sessionId) as [MemoryResult, string];

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

  // Filter to last 24 hours and format for display
  const recentItems = filterRecentMemories(items, RECENT_HOURS);
  const recentFormatted = formatMemorySummary(recentItems, MAX_RECENT_MEMORIES);

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

  // Show recent memories from last 24 hours
  if (recentFormatted.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h):`);
    lines.push(...recentFormatted);
  } else if (items.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h): none (older memories exist)`);
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
