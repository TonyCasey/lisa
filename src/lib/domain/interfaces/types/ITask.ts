/**
 * Task status values.
 */
export type TaskStatus = 'ready' | 'in-progress' | 'blocked' | 'done' | 'closed' | 'unknown';

/**
 * A task tracked in memory.
 */
export interface ITask {
  readonly key: string;
  readonly status: TaskStatus;
  readonly title: string;
  readonly blocked: readonly string[];
  readonly created_at?: string;
}

/**
 * Input for creating a new task.
 */
export interface ITaskInput {
  readonly title: string;
  readonly status?: TaskStatus;
  readonly blocked?: readonly string[];
}

/**
 * Input for updating an existing task.
 */
export interface ITaskUpdate {
  readonly status?: TaskStatus;
  readonly title?: string;
  readonly blocked?: readonly string[];
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
