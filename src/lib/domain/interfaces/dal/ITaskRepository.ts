/**
 * Task Repository Interface
 *
 * Contract for task data access operations.
 * Implementations may use MCP, Neo4j, or Zep Cloud as backend.
 */

import { ITask, ITaskInput, ITaskUpdate, ITaskCounts } from '../types/ITask';
import { IQueryOptions, ITaskQueryResult } from './types';

/**
 * Task repository read operations.
 */
export interface ITaskRepositoryReader {
  /**
   * Find tasks by group IDs with optional filtering and sorting.
   * @param groupIds - Group IDs to search (hierarchical)
   * @param options - Query options (sort, limit, etc.)
   */
  findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<ITaskQueryResult>;

  /**
   * Find a task by its key.
   * @param groupId - Group ID containing the task
   * @param taskKey - Task key/identifier
   */
  findByKey(
    groupId: string,
    taskKey: string
  ): Promise<ITask | null>;

  /**
   * Find tasks by status.
   * @param groupIds - Group IDs to search
   * @param status - Status to filter by
   * @param options - Additional options
   */
  findByStatus(
    groupIds: readonly string[],
    status: ITask['status'],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<ITaskQueryResult>;

  /**
   * Get task counts by status.
   * @param groupIds - Group IDs to count
   */
  getCounts(groupIds: readonly string[]): Promise<ITaskCounts>;
}

/**
 * Task repository write operations.
 */
export interface ITaskRepositoryWriter {
  /**
   * Create a new task.
   * @param groupId - Group ID to create in
   * @param task - Task input data
   */
  create(groupId: string, task: ITaskInput): Promise<ITask>;

  /**
   * Update an existing task.
   * @param groupId - Group ID containing the task
   * @param taskKey - Task key/identifier
   * @param updates - Fields to update
   */
  update(
    groupId: string,
    taskKey: string,
    updates: ITaskUpdate
  ): Promise<ITask>;

  /**
   * Delete a task.
   * @param groupId - Group ID containing the task
   * @param taskKey - Task key/identifier
   */
  delete(groupId: string, taskKey: string): Promise<void>;
}

/**
 * Task repository capabilities.
 */
export interface ITaskRepositoryCapabilities {
  /**
   * Check if this repository supports write operations.
   * Neo4j direct is read-only; MCP and Zep support writes.
   */
  supportsWrite(): boolean;

  /**
   * Check if this repository supports task counts aggregation.
   * Neo4j is most efficient for this.
   */
  supportsAggregation(): boolean;
}

/**
 * Complete task repository interface.
 */
export interface ITaskRepository
  extends ITaskRepositoryReader,
    ITaskRepositoryWriter,
    ITaskRepositoryCapabilities {}

/**
 * Read-only task repository (e.g., Neo4j direct).
 */
export interface IReadOnlyTaskRepository
  extends ITaskRepositoryReader,
    ITaskRepositoryCapabilities {}
