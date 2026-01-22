/**
 * Tasks Skill CLI Client
 *
 * Provides typed helpers for invoking the tasks skill script.
 * Used by integration tests to verify I/O contracts from SKILL.md.
 */
import { setTimeout as delay } from 'node:timers/promises';
import {
  findSkillScript,
  runSkillScript,
} from '../shared/cli-runner';
import type { ICliRunnerOptions } from '../shared/types';

// =============================================================================
// I/O Contract Types (from SKILL.md)
// =============================================================================

/**
 * Task structure stored/retrieved by tasks skill
 */
export interface ITask {
  title: string;
  status: 'todo' | 'doing' | 'done' | 'unknown';
  repo?: string;
  assignee?: string;
  notes?: string;
  tag?: string;
  message_uuid?: string;
  episode_uuid?: string;
  created_at?: string;
}

/**
 * Response from tasks add operation
 * SKILL.md: { status: "ok", action: "add", task: { text, status, group } }
 */
export interface ITaskAddResponse {
  status: 'ok' | 'fallback';
  action: 'add';
  task: ITask;
  group: string;
  message_uuid?: string;
  mode?: 'local' | 'zep-cloud';
}

/**
 * Response from tasks update operation
 */
export interface ITaskUpdateResponse {
  status: 'ok' | 'fallback';
  action: 'update';
  task: ITask;
  group: string;
  message_uuid?: string;
  mode?: 'local' | 'zep-cloud';
}

/**
 * Response from tasks list operation
 * SKILL.md: { status: "ok", action: "list", tasks: [...] }
 */
export interface ITaskListResponse {
  status: 'ok' | 'fallback';
  action: 'list';
  group: string;
  groups?: string[];
  tasks: ITask[];
  mode?: 'local' | 'zep-cloud';
}

/**
 * Fallback response when backend is unavailable
 * SKILL.md: { status: "fallback", error, fallback: <cached object> }
 */
export interface ITaskFallbackResponse {
  status: 'fallback';
  error: string;
  fallback: ITaskAddResponse | ITaskListResponse;
}

export type TaskResponse =
  | ITaskAddResponse
  | ITaskUpdateResponse
  | ITaskListResponse
  | ITaskFallbackResponse;

// =============================================================================
// Script Detection
// =============================================================================

/** Full path to tasks script, or null if not found */
export const tasksScriptPath = findSkillScript('tasks');

/** Whether the tasks script exists (requires build) */
export const tasksScriptExists = tasksScriptPath !== null;

// =============================================================================
// Client Options
// =============================================================================

export interface ITasksClientOptions extends ICliRunnerOptions {
  /** Maximum number of tasks to return (default: 20) */
  limit?: number;
  /** Task status (todo, doing, done) */
  status?: 'todo' | 'doing' | 'done';
  /** Tag to apply to task */
  tag?: string;
  /** Repository name */
  repo?: string;
  /** Assignee name */
  assignee?: string;
  /** Additional notes */
  notes?: string;
}

// =============================================================================
// Task Operations
// =============================================================================

/**
 * Add a task via the skill script
 *
 * @param title - Task title/description
 * @param options - Client options
 * @returns Add response with status and task object
 * @throws Error if script not found or execution fails
 */
export async function addTask(
  title: string,
  options: ITasksClientOptions = {}
): Promise<ITaskAddResponse> {
  if (!tasksScriptPath) {
    throw new Error('Tasks script not found. Run `npm run build` first.');
  }

  const args = ['add', `"${title.replace(/"/g, '\\"')}"`];
  if (options.status) args.push('--status', options.status);
  if (options.tag) args.push('--tag', options.tag);
  if (options.repo) args.push('--repo', options.repo);
  if (options.assignee) args.push('--assignee', options.assignee);
  if (options.notes) args.push('--notes', `"${options.notes.replace(/"/g, '\\"')}"`);

  const result = await runSkillScript<ITaskAddResponse>(
    tasksScriptPath,
    args,
    options
  );

  if (!result.data) {
    throw new Error(result.error || 'Failed to add task: no response data');
  }

  // Allow both 'ok' and 'fallback' status
  if (result.data.status !== 'ok' && result.data.status !== 'fallback') {
    throw new Error(`Unexpected status: ${result.data.status}`);
  }

  return result.data;
}

/**
 * List tasks via the skill script
 *
 * @param options - Client options including limit
 * @returns List response with tasks array
 * @throws Error if script not found or execution fails
 */
export async function listTasks(
  options: ITasksClientOptions = {}
): Promise<ITaskListResponse> {
  if (!tasksScriptPath) {
    throw new Error('Tasks script not found. Run `npm run build` first.');
  }

  const args = ['list'];
  if (options.limit) args.push('--limit', String(options.limit));

  const result = await runSkillScript<ITaskListResponse>(
    tasksScriptPath,
    args,
    options
  );

  if (!result.data) {
    throw new Error(result.error || 'Failed to list tasks: no response data');
  }

  // Allow both 'ok' and 'fallback' status
  if (result.data.status !== 'ok' && result.data.status !== 'fallback') {
    throw new Error(`Unexpected status: ${result.data.status}`);
  }

  return result.data;
}

/**
 * Update a task via the skill script
 *
 * @param title - Task title to update
 * @param options - Client options including new status
 * @returns Update response with updated task
 * @throws Error if script not found or execution fails
 */
export async function updateTask(
  title: string,
  options: ITasksClientOptions = {}
): Promise<ITaskUpdateResponse> {
  if (!tasksScriptPath) {
    throw new Error('Tasks script not found. Run `npm run build` first.');
  }

  const args = ['update', `"${title.replace(/"/g, '\\"')}"`];
  if (options.status) args.push('--status', options.status);
  if (options.tag) args.push('--tag', options.tag);

  const result = await runSkillScript<ITaskUpdateResponse>(
    tasksScriptPath,
    args,
    options
  );

  if (!result.data) {
    throw new Error(result.error || 'Failed to update task: no response data');
  }

  // Allow both 'ok' and 'fallback' status
  if (result.data.status !== 'ok' && result.data.status !== 'fallback') {
    throw new Error(`Unexpected status: ${result.data.status}`);
  }

  return result.data;
}

/**
 * Check if the tasks endpoint is reachable
 *
 * @param options - Client options
 * @returns Object with ok status and optional error
 */
export async function checkTasksEndpoint(
  options: ITasksClientOptions = {}
): Promise<{ ok: boolean; error?: Error }> {
  try {
    const result = await listTasks({ ...options, limit: 1 });
    return { ok: result.status === 'ok' };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/**
 * Run a smoke test suite for tasks persistence and isolation
 *
 * Tests:
 * 1. Add task to primary group
 * 2. List from primary group and verify found
 * 3. List from isolation group and verify NOT found
 *
 * @param options - Suite configuration
 * @returns Suite results with pass/fail status
 */
export async function runTasksSmokeSuite(options: {
  endpoint?: string;
  groupId: string;
  isolationGroupId: string;
}): Promise<{
  addResponse: ITaskAddResponse;
  listResponse: ITaskListResponse;
  taskFound: boolean;
  isolationLeaked: boolean;
}> {
  const uniqueMarker = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Add task with meaningful content for LLM fact extraction
  const addResponse = await addTask(
    `Implement database migration for feature ${uniqueMarker}`,
    {
      endpoint: options.endpoint,
      groupId: options.groupId,
      status: 'todo',
    }
  );

  // Wait for eventual consistency (Graphiti processes asynchronously)
  // LLM fact extraction takes time
  await delay(10000);

  // List from primary group
  const listResponse = await listTasks({
    endpoint: options.endpoint,
    groupId: options.groupId,
    limit: 25,
  });

  // Check if task was found (look for the unique marker in extracted facts)
  const taskFound = listResponse.tasks.some((task) =>
    task.title.includes(uniqueMarker)
  );

  // List from isolation group (should NOT find the task)
  const isolationList = await listTasks({
    endpoint: options.endpoint,
    groupId: options.isolationGroupId,
    limit: 15,
  });

  const isolationLeaked = isolationList.tasks.some((task) =>
    task.title.includes(uniqueMarker)
  );

  return {
    addResponse,
    listResponse,
    taskFound,
    isolationLeaked,
  };
}
