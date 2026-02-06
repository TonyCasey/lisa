/**
 * GitMemTaskService
 *
 * Adapter that maps Lisa's ITaskService interface to git-mem's MemoryService.
 * Tasks are stored as memories with tag conventions:
 *   - 'task' tag to identify task memories
 *   - 'task_id:<key>' for unique identification
 *   - 'status:<status>' for current status
 *   - 'group:<groupId>' for scoping
 */

import type { IMemoryService as IGitMemMemoryService, IMemoryEntity } from 'git-mem/dist/index';
import type { ITaskService } from '../../domain/interfaces/ITaskService';
import type {
  ITask,
  ITaskInput,
  ITaskUpdate,
  ITaskCounts,
  TaskStatus,
} from '../../domain/interfaces/types/ITask';
import { emptyTaskCounts } from '../../domain/interfaces/types/ITask';

const TASK_TAG = 'task';

function parseTaskId(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith('task_id:')) {
      return tag.slice(7);
    }
  }
  return null;
}

function parseStatus(tags: readonly string[]): TaskStatus {
  for (const tag of tags) {
    if (tag.startsWith('status:')) {
      return tag.slice(7) as TaskStatus;
    }
  }
  return 'unknown';
}

function parseBlocked(tags: readonly string[]): string[] {
  const blocked: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith('blocked_by:')) {
      blocked.push(tag.slice(11));
    }
  }
  return blocked;
}

function toTask(entity: IMemoryEntity): ITask {
  const taskId = parseTaskId(entity.tags);
  const title = entity.content.startsWith('TASK: ')
    ? entity.content.slice(6)
    : entity.content;

  return {
    key: taskId || entity.id,
    status: parseStatus(entity.tags),
    title,
    blocked: parseBlocked(entity.tags),
    created_at: entity.createdAt,
  };
}

function buildTaskTags(
  groupId: string,
  key: string,
  status: TaskStatus,
  blocked?: readonly string[]
): string[] {
  const tags = [TASK_TAG, `task_id:${key}`, `status:${status}`, `group:${groupId}`];
  if (blocked) {
    for (const b of blocked) {
      tags.push(`blocked_by:${b}`);
    }
  }
  return tags;
}

/**
 * Deduplicate tasks by task_id, keeping latest (first in date-desc order).
 */
function deduplicateByTaskId(tasks: ITask[]): ITask[] {
  const seen = new Set<string>();
  const result: ITask[] = [];
  for (const task of tasks) {
    if (!seen.has(task.key)) {
      seen.add(task.key);
      result.push(task);
    }
  }
  return result;
}

export class GitMemTaskService implements ITaskService {
  constructor(private readonly gitMem: IGitMemMemoryService) {}

  async getTasks(
    groupIds: readonly string[],
    _aliases: readonly string[],
    _branch: string | null
  ): Promise<readonly ITask[]> {
    return this.getTasksSimple(groupIds);
  }

  async getTasksSimple(groupIds: readonly string[]): Promise<readonly ITask[]> {
    const { memories } = this.gitMem.recall(undefined, {
      tag: TASK_TAG,
      limit: 200,
    });

    const groupTags = groupIds.map(g => `group:${g}`);
    const filtered = memories.filter(m =>
      groupTags.length === 0 || m.tags.some(t => groupTags.includes(t))
    );

    const tasks = filtered.map(toTask);
    return deduplicateByTaskId(tasks);
  }

  async getTaskCounts(groupIds: readonly string[]): Promise<ITaskCounts> {
    const tasks = await this.getTasksSimple(groupIds);
    const counts = emptyTaskCounts();
    const mutable = counts as unknown as Record<string, number>;

    for (const task of tasks) {
      if (task.status in mutable) {
        mutable[task.status]++;
      } else {
        mutable['unknown']++;
      }
    }

    return counts;
  }

  async createTask(groupId: string, task: ITaskInput): Promise<ITask> {
    const key = `task-${Date.now()}`;
    const status = task.status || 'ready';

    this.gitMem.remember(`TASK: ${task.title}`, {
      tags: buildTaskTags(groupId, key, status, task.blocked),
    });

    return {
      key,
      status,
      title: task.title,
      blocked: task.blocked ? [...task.blocked] : [],
      created_at: new Date().toISOString(),
    };
  }

  async updateTask(
    groupId: string,
    taskId: string,
    updates: ITaskUpdate
  ): Promise<ITask> {
    // Find existing task
    const tasks = await this.getTasksSimple([groupId]);
    const existing = tasks.find(t => t.key === taskId);

    const title = updates.title ?? existing?.title ?? 'Unknown task';
    const status = updates.status ?? existing?.status ?? 'ready';
    const blocked = updates.blocked ?? existing?.blocked ?? [];

    // Create updated task memory (new memory with same task_id, latest wins)
    this.gitMem.remember(`TASK: ${title}`, {
      tags: buildTaskTags(groupId, taskId, status, blocked),
    });

    return {
      key: taskId,
      status,
      title,
      blocked: [...blocked],
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
  }
}
