import type { ITask, ITaskInput, ITaskUpdate, ITaskCounts } from './types';

/**
 * Read operations for tasks.
 * Separated for Interface Segregation Principle.
 */
export interface ITaskReader {
  /**
   * Get all tasks for a group.
   * @param groupIds - Hierarchical group IDs to query
   * @param aliases - Project aliases for tagging
   * @param branch - Current git branch (for tagging)
   */
  getTasks(
    groupIds: readonly string[],
    aliases: readonly string[],
    branch: string | null
  ): Promise<readonly ITask[]>;

  /**
   * Get tasks with simple interface (no aliases/branch).
   * Uses DAL router with Neo4j when available for date ordering.
   * @param groupIds - Group IDs to query
   */
  getTasksSimple(groupIds: readonly string[]): Promise<readonly ITask[]>;

  /**
   * Get task counts by status.
   * Uses DAL router with Neo4j when available for efficient aggregation.
   * @param groupIds - Group IDs to query
   */
  getTaskCounts(groupIds: readonly string[]): Promise<ITaskCounts>;
}

/**
 * Write operations for tasks.
 * Separated for Interface Segregation Principle.
 */
export interface ITaskWriter {
  /**
   * Create a new task.
   * @param groupId - Group ID to create task in
   * @param task - Task input data
   */
  createTask(groupId: string, task: ITaskInput): Promise<ITask>;

  /**
   * Update an existing task.
   * @param groupId - Group ID containing the task
   * @param taskId - Task ID to update
   * @param updates - Fields to update
   */
  updateTask(groupId: string, taskId: string, updates: ITaskUpdate): Promise<ITask>;
}

/**
 * Full task service interface.
 * Combines read and write operations.
 */
export interface ITaskService extends ITaskReader, ITaskWriter {}
