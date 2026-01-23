/**
 * Task status values.
 */
export type TaskStatus = 'ready' | 'in-progress' | 'blocked' | 'done' | 'closed' | 'unknown';

/**
 * External system link source types.
 */
export type ExternalLinkSource = 'github' | 'jira' | 'linear';

/**
 * Link to an external task management system.
 */
export interface ITaskExternalLink {
  readonly source: ExternalLinkSource;
  readonly id: string;        // e.g., "123" for GitHub issue #123, "PROJ-456" for Jira
  readonly url: string;       // Full URL to the external item
  readonly syncedAt?: string; // ISO timestamp of last sync
}

/**
 * A task tracked in memory.
 */
export interface ITask {
  readonly key: string;
  readonly status: TaskStatus;
  readonly title: string;
  readonly blocked: readonly string[];
  readonly created_at?: string;
  readonly externalLink?: ITaskExternalLink;
}

/**
 * Input for creating a new task.
 */
export interface ITaskInput {
  readonly title: string;
  readonly status?: TaskStatus;
  readonly blocked?: readonly string[];
  readonly externalLink?: ITaskExternalLink;
}

/**
 * Input for updating an existing task.
 */
export interface ITaskUpdate {
  readonly status?: TaskStatus;
  readonly title?: string;
  readonly blocked?: readonly string[];
  readonly externalLink?: ITaskExternalLink | null; // null to unlink
}

/**
 * Task counts by status.
 */
export interface ITaskCounts {
  readonly ready: number;
  readonly 'in-progress': number;
  readonly blocked: number;
  readonly done: number;
  readonly closed: number;
  readonly unknown: number;
}

/**
 * Create empty task counts.
 */
export function emptyTaskCounts(): ITaskCounts {
  return {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
  };
}
