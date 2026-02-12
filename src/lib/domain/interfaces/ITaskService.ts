import type { ITask, ITaskInput, ITaskUpdate, ITaskCounts } from './types';

/**
 * Read operations for tasks.
 * Separated for Interface Segregation Principle.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface ITaskReader {
  /**
   * Get all tasks.
   */
  getTasks(): Promise<readonly ITask[]>;

  /**
   * Get tasks with simple interface.
   */
  getTasksSimple(): Promise<readonly ITask[]>;

  /**
   * Get task counts by status.
   */
  getTaskCounts(): Promise<ITaskCounts>;
}

/**
 * Write operations for tasks.
 * Separated for Interface Segregation Principle.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface ITaskWriter {
  /**
   * Create a new task.
   * @param task - Task input data
   */
  createTask(task: ITaskInput): Promise<ITask>;

  /**
   * Update an existing task.
   * @param taskId - Task ID to update
   * @param updates - Fields to update
   */
  updateTask(taskId: string, updates: ITaskUpdate): Promise<ITask>;
}

/**
 * Full task service interface.
 * Combines read and write operations.
 */
export interface ITaskService extends ITaskReader, ITaskWriter {}
