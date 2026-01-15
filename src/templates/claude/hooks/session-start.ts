#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - Session Start Hook
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This ensures Claude has access to prior work, tasks, and project context.
 *
 * Handles all SessionStart trigger types:
 * - startup: Initial session start
 * - resume: Resuming an existing session
 * - compact: After auto-compact operation (context was summarized)
 * - clear: After /clear command
 *
 * Configuration: .claude/settings.json -> hooks.SessionStart
 */

const { rpcCall, withGroup, getCurrentGroupId, getHierarchicalGroupIds } = require('./common/mcp-client');
const { detectRepo, detectBranch, repoTags, getUserName, getProjectAliases } = require('./common/context');
const { detectFolderMetadata, formatFolderMetadata } = require('./common/group-id');

// Session start trigger types
type SessionTrigger = 'startup' | 'resume' | 'compact' | 'clear';

interface HookInput {
  trigger?: SessionTrigger;
  session_type?: SessionTrigger;
}

/**
 * Read hook input from stdin (JSON with trigger type and session info)
 */
async function readStdin(): Promise<HookInput> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as HookInput);
      } catch {
        resolve({});
      }
    });
    // Timeout if no stdin after 100ms (for manual testing)
    setTimeout(() => {
      if (!data) resolve({});
    }, 100);
  });
}

/**
 * Get trigger-specific messaging
 */
function getTriggerMessage(trigger: SessionTrigger): string {
  switch (trigger) {
    case 'startup':
      return 'Memory loaded for session start.';
    case 'resume':
      return 'Memory loaded for session resume.';
    case 'compact':
      return 'Memory reloaded after context compaction.';
    case 'clear':
      return 'Memory loaded after context clear.';
    default:
      return 'Memory loaded for session start.';
  }
}

/**
 * Get trigger-specific reminders (shown after compact/clear)
 */
function getTriggerReminders(trigger: SessionTrigger): string[] {
  const reminders: string[] = [];
  if (trigger === 'compact') {
    reminders.push('Note: Context was compacted. Previously loaded skills may need to be re-invoked if needed.');
  }
  if (trigger === 'clear') {
    reminders.push('Note: Context was cleared. Start fresh or use /memory to recall prior work.');
  }
  return reminders;
}

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

// Overall timeout for memory loading to avoid blocking session start
const MEMORY_LOAD_TIMEOUT_MS = 5000; // 5 seconds max

interface MemoryLoadResult {
  facts: MemoryNode[];
  nodes: MemoryNode[];
  tasks: MemoryNode[];
  initReview: string | null;
  timedOut: boolean;
}

/**
 * Load all memory with an overall timeout
 * Returns partial results if timeout occurs
 */
async function loadMemoryWithTimeout(
  aliases: string[],
  hierarchicalGroups: string[],
  branch: string | null
): Promise<MemoryLoadResult> {
  const result: MemoryLoadResult = {
    facts: [],
    nodes: [],
    tasks: [],
    initReview: null,
    timedOut: false,
  };

  let sessionId: string | null = null;

  const loadPromise = async (): Promise<void> => {
    // Load init-review memory first (codebase summary)
    try {
      const initParams = {
        query: 'init-review',
        max_facts: 1,
        order: 'desc',
        group_ids: hierarchicalGroups,
        tags: ['type:init-review'],
      };
      const [initResp, sid] = (await rpcCall('search_memory_facts', initParams, sessionId)) as [MemoryResult, string];
      sessionId = sid;

      const initFacts = initResp?.result?.facts || initResp?.facts || [];
      if (initFacts.length > 0) {
        const fact = initFacts[0];
        result.initReview = fact.fact || fact.name || null;
      }
    } catch {
      // Continue if init-review load fails
    }

    // Load recent facts/nodes from memory using hierarchical groups
    try {
      const seenUuids = new Set<string>();

      // Query with hierarchical groups (current folder + all parents)
      const recentParams = { query: '*', max_facts: 100, order: 'desc', group_ids: hierarchicalGroups };
      const [recentResp, sid] = (await rpcCall('search_memory_facts', recentParams, sessionId)) as [MemoryResult, string];
      sessionId = sid;

      const recentFacts = recentResp?.result?.facts || recentResp?.facts || [];
      for (const fact of recentFacts) {
        const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
        if (!seenUuids.has(uuid)) {
          seenUuids.add(uuid);
          result.facts.push(fact);
        }
      }

      // Also query by repo aliases to catch any repo-specific memories
      for (const alias of aliases) {
        const baseParams = { query: alias, tags: repoTags({ repo: alias, branch }) };
        const factParams = { ...baseParams, max_facts: 50, order: 'desc', group_ids: hierarchicalGroups };
        const [factResp] = (await rpcCall('search_memory_facts', factParams, sessionId)) as [MemoryResult, string];

        const aliasedFacts = factResp?.result?.facts || factResp?.facts || [];
        for (const fact of aliasedFacts) {
          const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
          if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            result.facts.push(fact);
          }
        }
      }

      // Fall back to nodes if no facts found
      if (!result.facts.length) {
        for (const alias of aliases) {
          const baseParams = { query: alias, tags: repoTags({ repo: alias, branch }) };
          const nodeParams = { ...baseParams, max_nodes: 20, group_ids: hierarchicalGroups };
          const [nodeResp] = (await rpcCall('search_nodes', nodeParams, sessionId)) as [MemoryResult, string];
          const aliasedNodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
          for (const node of aliasedNodes) {
            const uuid = node.uuid || `${node.name}-${node.fact}`;
            if (!seenUuids.has(uuid)) {
              seenUuids.add(uuid);
              result.nodes.push(node);
            }
          }
        }
      }
    } catch {
      // Continue if memory load fails
    }

    // Load tasks for this repo
    try {
      const seenTaskUuids = new Set<string>();

      for (const alias of aliases) {
        const taskParams = {
          query: 'task',
          tags: ['type:task', ...repoTags({ repo: alias, branch })],
          max_nodes: 200,
          group_ids: hierarchicalGroups,
        };
        const [taskResp] = (await rpcCall('search_nodes', taskParams, sessionId)) as [MemoryResult, string];
        const aliasedTasks = taskResp?.result?.nodes || taskResp?.nodes || [];
        for (const task of aliasedTasks) {
          const uuid = task.uuid || `${task.name}-${task.fact}`;
          if (!seenTaskUuids.has(uuid)) {
            seenTaskUuids.add(uuid);
            result.tasks.push(task);
          }
        }
      }
    } catch {
      // Continue if task load fails
    }
  };

  // Race between loading and timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      result.timedOut = true;
      resolve();
    }, MEMORY_LOAD_TIMEOUT_MS);
  });

  await Promise.race([loadPromise(), timeoutPromise]);

  return result;
}

async function main(): Promise<void> {
  // Read hook input to get trigger type (startup, resume, compact, clear)
  const hookInput = await readStdin();
  const trigger: SessionTrigger = hookInput.trigger || hookInput.session_type || 'startup';

  const repo = detectRepo();
  const branch = detectBranch();
  const aliases = getProjectAliases(); // Get all aliases including folder name
  const user = getUserName();

  // Folder-based group hierarchy
  const hierarchicalGroups = getHierarchicalGroupIds();
  const folderMetadata = detectFolderMetadata();
  const folderType = formatFolderMetadata(folderMetadata);
  const cwd = process.cwd();

  // Load memory with timeout to avoid blocking session start
  const memoryResult = await loadMemoryWithTimeout(aliases, hierarchicalGroups, branch);

  const facts = memoryResult.facts;
  const nodes = memoryResult.nodes;
  const taskNodes = memoryResult.tasks;
  const initReview = memoryResult.initReview;

  // Process items (rest of the function continues as before)
  // Note: We removed the inline loading code and now use memoryResult

  // Build task list from loaded task nodes
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

  // Build output - show folder context with type
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  const items = facts.length ? facts : nodes;

  // Filter to last 24 hours and format for display
  const recentItems = filterRecentMemories(items, RECENT_HOURS);
  const recentFormatted = formatMemorySummary(recentItems, MAX_RECENT_MEMORIES);

  const lines: string[] = [];

  // Show trigger-specific message with timeout warning if applicable
  const baseMessage = getTriggerMessage(trigger);
  if (memoryResult.timedOut) {
    lines.push(`${baseMessage.replace('.', '')} (partial - timed out after ${MEMORY_LOAD_TIMEOUT_MS / 1000}s).`);
  } else {
    lines.push(baseMessage);
  }

  // Add trigger-specific reminders (for compact/clear)
  const reminders = getTriggerReminders(trigger);
  if (reminders.length) {
    reminders.forEach((r) => lines.push(r));
  }

  // Show folder path with detected type (e.g., "TypeScript/React project")
  const folderDisplay = cwd.replace(process.env.HOME || '', '~');
  lines.push(`User: ${user} | Folder: ${folderDisplay} (${folderType})`);
  lines.push(`Repo: ${repoLabel}`);

  // Show init-review (codebase summary) if available
  if (initReview) {
    lines.push('');
    lines.push('Codebase Summary:');
    lines.push(`  ${initReview}`);
    lines.push('');
  }

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
      const readyList = ready
        .slice(0, 2)
        .map((t) => `${t.key} - ${t.title}`)
        .join(' | ');
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
  let summary = itemCount || taskCount ? `${itemCount} memories, ${taskCount} tasks` : 'no prior context';
  if (memoryResult.timedOut) {
    summary += ' (partial)';
  }
  // Show trigger type for transparency
  const triggerLabel = trigger === 'startup' ? '' : ` (${trigger})`;
  console.error(`[Memory loaded${triggerLabel}: ${summary}]`);
}

main().catch((err: Error) => {
  // Don't block session start on errors - just log and exit cleanly
  console.log(`Memory load skipped: ${err.message}`);
  process.exit(0);
});
