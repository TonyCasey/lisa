/**
 * Task service interface for skill scripts.
 * Provides a clean API for task CRUD operations.
 */

/**
 * External system link source types.
 */
export type ExternalLinkSource = 'github' | 'jira' | 'linear';

/**
 * Link to an external task management system.
 */
export interface ITaskExternalLink {
  source: ExternalLinkSource;
  id: string;        // e.g., "123" for GitHub issue #123, "PROJ-456" for Jira
  url: string;       // Full URL to the external item
  syncedAt?: string; // ISO timestamp of last sync
}

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
  externalLink?: ITaskExternalLink;
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
    externalLink?: ITaskExternalLink;
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
  externalLink?: ITaskExternalLink | null; // null to unlink
}

/**
 * Result of a task link operation.
 */
export interface ITaskLinkResult {
  status: 'ok';
  action: 'link' | 'unlink';
  task: {
    title: string;
    uuid: string;
    externalLink?: ITaskExternalLink;
  };
  group: string;
  mode: 'mcp' | 'zep-cloud';
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

  /**
   * Link a task to an external system (GitHub, Jira, etc.).
   *
   * @param taskUuid - UUID of the task to link
   * @param groupId - Group identifier
   * @param externalLink - External link details
   */
  link(
    taskUuid: string,
    groupId: string,
    externalLink: ITaskExternalLink
  ): Promise<ITaskLinkResult>;

  /**
   * Unlink a task from its external system.
   *
   * @param taskUuid - UUID of the task to unlink
   * @param groupId - Group identifier
   */
  unlink(
    taskUuid: string,
    groupId: string
  ): Promise<ITaskLinkResult>;

  /**
   * List tasks filtered by external link source.
   *
   * @param groupIds - Group identifiers to search
   * @param source - External link source to filter by (optional, returns all linked if omitted)
   * @param limit - Maximum number of tasks to return
   * @param defaultRepo - Default repo name for tasks without one
   * @param defaultAssignee - Default assignee for tasks without one
   */
  listLinked(
    groupIds: string[],
    source: ExternalLinkSource | undefined,
    limit: number,
    defaultRepo: string,
    defaultAssignee: string
  ): Promise<ITaskListResult>;
}
