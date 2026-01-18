/**
 * Task service interface for skill scripts.
 * Provides a clean API for task CRUD operations.
 */

/**
 * A task item.
 */
export interface ITask {
  title: string;
  status: string;
  repo: string;
  assignee: string;
  notes?: string;
  tag?: string | null;
  uuid: string;
  created_at: string;
}

/**
 * Result of a task list operation.
 */
export interface ITaskListResult {
  status: 'ok';
  action: 'list';
  group: string;
  groups: string[];
  tasks: ITask[];
  mode: 'neo4j' | 'mcp' | 'zep-cloud';
}

/**
 * Result of a task add/update operation.
 */
export interface ITaskWriteResult {
  status: 'ok';
  action: 'add' | 'update';
  task: {
    type: 'task';
    title: string;
    status: string;
    repo: string;
    assignee: string;
    notes?: string;
    tag?: string | null;
  };
  group: string;
  result?: unknown;
  message_uuid?: string;
  mode: 'mcp' | 'zep-cloud';
}

/**
 * Options for adding or updating a task.
 */
export interface ITaskWriteOptions {
  status?: string;
  repo?: string;
  assignee?: string;
  notes?: string;
  tag?: string | null;
}

/**
 * Task service interface.
 */
export interface ITaskService {
  /**
   * List tasks from storage.
   * Always uses Neo4j direct for better date ordering.
   *
   * @param groupIds - Group identifiers to search
   * @param limit - Maximum number of tasks to return
   * @param defaultRepo - Default repo name for tasks without one
   * @param defaultAssignee - Default assignee for tasks without one
   */
  list(
    groupIds: string[],
    limit: number,
    defaultRepo: string,
    defaultAssignee: string
  ): Promise<ITaskListResult>;

  /**
   * Add a new task.
   * Uses MCP or Zep depending on configuration.
   *
   * @param title - Task title/description
   * @param groupId - Group identifier for storage
   * @param options - Additional task options
   */
  add(
    title: string,
    groupId: string,
    options: ITaskWriteOptions
  ): Promise<ITaskWriteResult>;

  /**
   * Update an existing task (creates a new version).
   * Uses MCP or Zep depending on configuration.
   *
   * @param title - Task title/description
   * @param groupId - Group identifier for storage
   * @param options - Updated task options
   */
  update(
    title: string,
    groupId: string,
    options: ITaskWriteOptions
  ): Promise<ITaskWriteResult>;
}
