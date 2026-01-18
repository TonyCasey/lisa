/**
 * Task Loader - Pure functions for processing tasks from memory
 *
 * Extracts task information from memory nodes and provides
 * aggregated summaries for display.
 */

import type { IMemoryItem, ITask, ITaskCounts, ITaskSummary } from './types';

// =============================================================================
// Tag Extractors
// =============================================================================

/**
 * Extract task ID from tags (e.g., "task_id:abc123")
 */
export function getTaskId(tags: string[] = []): string | null {
  const tag = tags.find((t) => t.startsWith('task_id:'));
  return tag ? tag.replace('task_id:', '') : null;
}

/**
 * Extract task number from tags (e.g., "task_num:5")
 */
export function getTaskNum(tags: string[] = []): string | null {
  const tag = tags.find((t) => t.startsWith('task_num:'));
  return tag ? tag.replace('task_num:', '') : null;
}

/**
 * Extract task status from tags (e.g., "status:in-progress")
 */
export function getTaskStatus(tags: string[] = []): string {
  const tag = tags.find((t) => t.startsWith('status:'));
  return tag ? tag.replace('status:', '').toLowerCase() : 'unknown';
}

/**
 * Extract blocked-by dependencies from tags (e.g., "blocked_by:task-1")
 */
export function getBlockedBy(tags: string[] = []): string[] {
  return tags
    .filter((t) => t.startsWith('blocked_by:'))
    .map((t) => t.replace('blocked_by:', ''));
}

// =============================================================================
// Memory Item Utilities
// =============================================================================

/**
 * Pick the latest memory item by created_at timestamp
 */
export function pickLatest(a: IMemoryItem = {}, b: IMemoryItem = {}): IMemoryItem {
  const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bTime > aTime ? b : a;
}

// =============================================================================
// Task Processing
// =============================================================================

/**
 * Convert a memory item to a task
 */
export function memoryItemToTask(key: string, item: IMemoryItem): ITask {
  return {
    key,
    status: getTaskStatus(item.tags),
    title: item.name || item.fact || item.uuid || '<untitled>',
    blocked: getBlockedBy(item.tags),
    created_at: item.created_at,
  };
}

/**
 * Deduplicate task nodes, keeping the latest version of each task
 */
export function deduplicateTasks(taskNodes: IMemoryItem[]): Map<string, IMemoryItem> {
  const tasksByKey = new Map<string, IMemoryItem>();

  for (const node of taskNodes) {
    const key = getTaskNum(node.tags) || getTaskId(node.tags);
    if (!key) continue;

    const existing = tasksByKey.get(key);
    const latest = existing ? pickLatest(existing, node) : node;
    tasksByKey.set(key, latest);
  }

  return tasksByKey;
}

/**
 * Create initial task counts object
 */
export function createTaskCounts(): ITaskCounts {
  return {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
  };
}

/**
 * Count tasks by status
 */
export function countTasksByStatus(tasks: ITask[]): ITaskCounts {
  const counts = createTaskCounts();

  for (const task of tasks) {
    const key = counts[task.status] === undefined ? 'unknown' : task.status;
    counts[key] += 1;
  }

  return counts;
}

/**
 * Sort tasks by created_at descending (most recent first)
 */
export function sortTasksByDate(tasks: ITask[]): ITask[] {
  return [...tasks].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Filter tasks by status
 */
export function filterTasksByStatus(tasks: ITask[], status: string): ITask[] {
  return tasks.filter((t) => t.status === status);
}

// =============================================================================
// Main Processing Function
// =============================================================================

/**
 * Process task nodes from memory into a task summary
 *
 * This is the main entry point for task processing. It:
 * 1. Deduplicates task nodes (keeping latest version)
 * 2. Converts to ITask objects
 * 3. Sorts by date
 * 4. Counts by status
 * 5. Identifies active and ready tasks
 *
 * @param taskNodes - Raw memory items tagged as tasks
 * @returns Task summary with counts and filtered lists
 */
export function processTasks(taskNodes: IMemoryItem[]): ITaskSummary {
  // Deduplicate by key, keeping latest
  const tasksByKey = deduplicateTasks(taskNodes);

  // Convert to task objects
  const tasks: ITask[] = Array.from(tasksByKey.entries()).map(([key, node]) =>
    memoryItemToTask(key, node)
  );

  // Sort by date (most recent first)
  const sortedTasks = sortTasksByDate(tasks);

  // Count by status
  const counts = countTasksByStatus(sortedTasks);

  // Get active (in-progress) and ready tasks
  const active = filterTasksByStatus(sortedTasks, 'in-progress');
  const ready = filterTasksByStatus(sortedTasks, 'ready');

  return {
    tasks: sortedTasks,
    counts,
    active,
    ready,
  };
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format task counts as a summary string
 * e.g., "2 in-progress, 3 ready, 1 blocked"
 */
export function formatTaskCountsSummary(counts: ITaskCounts): string {
  const parts: string[] = [];

  if (counts['in-progress']) parts.push(`${counts['in-progress']} in-progress`);
  if (counts.ready) parts.push(`${counts.ready} ready`);
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);
  if (counts.done) parts.push(`${counts.done} done`);
  if (counts.closed) parts.push(`${counts.closed} closed`);

  return parts.join(', ') || 'none active';
}

/**
 * Format a single task for display
 * e.g., "TASK-1 - Implement feature X"
 */
export function formatTask(task: ITask): string {
  return `${task.key} - ${task.title}`;
}

/**
 * Format a list of tasks for display
 */
export function formatTaskList(tasks: ITask[], limit: number = 2): string {
  return tasks
    .slice(0, limit)
    .map(formatTask)
    .join(' | ');
}
