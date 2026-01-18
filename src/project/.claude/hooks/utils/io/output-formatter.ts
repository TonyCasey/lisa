/**
 * Output Formatter - Format output for Claude Code hooks
 *
 * Provides consistent formatting for memory summaries, dates, and session output.
 * These are pure functions that take data and return formatted strings.
 */

import type { IMemoryItem, ITaskSummary, SessionTrigger, IMemoryGroup } from '../core/types';

// =============================================================================
// Configuration
// =============================================================================

/** Hours to look back for recent memories */
export const RECENT_HOURS = 24;

/** Maximum number of memory groups to display */
export const MAX_RECENT_MEMORIES = 5;

/** Time window for grouping memories (in minutes) */
export const GROUP_WINDOW_MINUTES = 5;

/** Relationship types to exclude (system noise) */
export const EXCLUDED_RELATIONSHIPS = new Set([
  'USER_SUBMITS_DIRECTION',
  'DIRECTION_IS_TOPIC',
  'EXPANDED_ENTITY_TYPES_TRACKED',
  'TESTS',
  'ASSESSES',
]);

// =============================================================================
// Date Formatting
// =============================================================================

/**
 * Format a date relative to now (Today, Yesterday, or "Mon 15")
 *
 * @param date - Date to format
 * @returns Formatted string like "Today 14:30" or "Jan 15 09:00"
 */
export function formatRelativeDate(date: Date): string {
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

// =============================================================================
// Memory Filtering
// =============================================================================

/**
 * Filter memories to meaningful ones from the last N hours
 *
 * Excludes:
 * - Memories without timestamps
 * - Memories older than cutoff
 * - Known noise relationship types
 *
 * @param memories - Array of memory items
 * @param hoursAgo - How many hours back to include (default: 24)
 * @returns Filtered array of recent, meaningful memories
 */
export function filterRecentMemories(
  memories: IMemoryItem[],
  hoursAgo: number = RECENT_HOURS
): IMemoryItem[] {
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

// =============================================================================
// Memory Grouping
// =============================================================================

/**
 * Extract common theme from a group of memory facts
 *
 * Attempts to find a common prefix among facts, falling back to
 * truncated first fact if no common theme found.
 */
export function extractGroupSummary(memories: IMemoryItem[]): string {
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
  commonPrefix = commonPrefix.replace(
    /\s+(the|a|an|is|are|was|were|includes?|has|have|with|for|to|of|in|on|at)$/i,
    ''
  );

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
 *
 * Groups memories that occurred within `windowMinutes` of each other,
 * creating a summary for each group.
 *
 * @param memories - Array of memory items
 * @param windowMinutes - Time window for grouping (default: 5)
 * @returns Array of memory groups, sorted by most recent first
 */
export function groupMemoriesByTime(
  memories: IMemoryItem[],
  windowMinutes: number = GROUP_WINDOW_MINUTES
): IMemoryGroup[] {
  if (!memories.length) return [];

  // Sort by created_at descending (most recent first)
  const sorted = [...memories].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  const groups: IMemoryGroup[] = [];
  let currentGroup: IMemoryItem[] = [];
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
 *
 * @param memories - Array of memory items
 * @param limit - Maximum number of groups to show (default: 5)
 * @returns Array of formatted strings like "  Today 14:30 - Fixed bug in parser"
 */
export function formatMemorySummary(
  memories: IMemoryItem[],
  limit: number = MAX_RECENT_MEMORIES
): string[] {
  const groups = groupMemoriesByTime(memories);

  // Take top N groups
  const topGroups = groups.slice(0, limit);

  // Format each group
  return topGroups.map((group) => {
    const dateStr = formatRelativeDate(group.timestamp);
    return `  ${dateStr} - ${group.summary}`;
  });
}

// =============================================================================
// Session Output Formatting
// =============================================================================

/**
 * Options for formatting session start output
 */
export interface ISessionStartFormatOptions {
  trigger: SessionTrigger;
  user: string;
  cwd: string;
  folderType: string;
  repo: string;
  branch: string | null;
  initReview: string | null;
  recentMemories: IMemoryItem[];
  taskSummary: ITaskSummary;
  timedOut: boolean;
  timeoutSeconds?: number;
}

/**
 * Format the complete session start output for Claude
 *
 * This is the main output that gets sent to Claude as context.
 *
 * @param options - All the data needed to format the output
 * @param triggerMessage - The trigger-specific message
 * @param triggerReminders - Any trigger-specific reminders
 * @param taskCountsSummary - Formatted task counts string
 * @returns Array of output lines
 */
export function formatSessionStartLines(
  options: ISessionStartFormatOptions,
  triggerMessage: string,
  triggerReminders: string[],
  taskCountsSummary: string,
  formatTaskFn: (task: { key: string; title: string }) => string,
  formatTaskListFn: (tasks: Array<{ key: string; title: string }>, limit: number) => string
): string[] {
  const {
    user,
    cwd,
    folderType,
    repo,
    branch,
    initReview,
    recentMemories,
    taskSummary,
    timedOut,
    timeoutSeconds = 5,
  } = options;

  const lines: string[] = [];

  // Trigger message with timeout warning if applicable
  if (timedOut) {
    lines.push(`${triggerMessage.replace('.', '')} (partial - timed out after ${timeoutSeconds}s).`);
  } else {
    lines.push(triggerMessage);
  }

  // Trigger-specific reminders
  for (const reminder of triggerReminders) {
    lines.push(reminder);
  }

  // User and folder info
  const folderDisplay = cwd.replace(process.env.HOME || '', '~');
  lines.push(`User: ${user} | Folder: ${folderDisplay} (${folderType})`);

  // Repo info
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  lines.push(`Repo: ${repoLabel}`);

  // Init-review (codebase summary) if available
  if (initReview) {
    lines.push('');
    lines.push('Codebase Summary:');
    lines.push(`  ${initReview}`);
    lines.push('');
  }

  // Recent memories
  const recentFiltered = filterRecentMemories(recentMemories, RECENT_HOURS);
  const recentFormatted = formatMemorySummary(recentFiltered, MAX_RECENT_MEMORIES);

  if (recentFormatted.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h):`);
    lines.push(...recentFormatted);
  } else if (recentMemories.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h): none (older memories exist)`);
  }

  // Tasks
  const { tasks, active, ready } = taskSummary;

  if (tasks.length) {
    lines.push(`Tasks: ${taskCountsSummary}`);

    if (active.length) {
      lines.push(`Active: ${formatTaskFn(active[0])}`);
    }
    if (ready.length) {
      lines.push(`Ready: ${formatTaskListFn(ready, 2)}`);
    }
  } else {
    lines.push('Tasks: none found for this repo');
  }

  return lines;
}

/**
 * Format the user-facing summary message (stderr)
 *
 * @param itemCount - Number of memory items loaded
 * @param taskCount - Number of tasks loaded
 * @param timedOut - Whether loading timed out
 * @param triggerLabel - Formatted trigger label (e.g., " (resume)")
 * @returns Formatted summary string
 */
export function formatUserSummary(
  itemCount: number,
  taskCount: number,
  timedOut: boolean,
  triggerLabel: string
): string {
  let summary = itemCount || taskCount
    ? `${itemCount} memories, ${taskCount} tasks`
    : 'no prior context';

  if (timedOut) {
    summary += ' (partial)';
  }

  return `[Memory loaded${triggerLabel}: ${summary}]`;
}
