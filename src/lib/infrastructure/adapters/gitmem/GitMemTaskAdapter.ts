/**
 * GitMemTaskAdapter
 *
 * Implements Lisa's ITaskService using git-mem's MemoryService.
 * Tasks are stored as memories with 'task' tag and status tags.
 */

import {
  MemoryService as GitMemMemoryService,
  MemoryRepository,
  NotesService,
} from 'git-mem';
import type { IMemoryEntity } from 'git-mem';
import type {
  ITaskService,
  ITask,
  ITaskInput,
  ITaskUpdate,
  ITaskCounts,
  TaskStatus,
} from '../../../domain';
import { emptyTaskCounts } from '../../../domain';

/**
 * Create a git-mem MemoryService instance with default wiring.
 */
function createGitMemService(): GitMemMemoryService {
  const notesService = new NotesService();
  const repository = new MemoryRepository(notesService);
  return new GitMemMemoryService(repository);
}

/**
 * Extract task status from tags.
 */
function getStatus(tags: readonly string[]): TaskStatus {
  for (const tag of tags) {
    if (tag.startsWith('status:')) {
      const s = tag.replace('status:', '');
      const valid: TaskStatus[] = ['ready', 'in-progress', 'blocked', 'done', 'closed'];
      if (valid.includes(s as TaskStatus)) return s as TaskStatus;
    }
  }
  return 'unknown';
}

/**
 * Convert a git-mem memory entity to a Lisa ITask.
 */
function toTask(entity: IMemoryEntity): ITask {
  const tags = [...entity.tags];
  return {
    key: entity.id,
    status: getStatus(tags),
    title: entity.content,
    blocked: tags
      .filter(t => t.startsWith('blocked_by:'))
      .map(t => t.replace('blocked_by:', '')),
    created_at: entity.createdAt,
  };
}

export class GitMemTaskAdapter implements ITaskService {
  private readonly gitMem: GitMemMemoryService;

  constructor(gitMem?: GitMemMemoryService) {
    this.gitMem = gitMem ?? createGitMemService();
  }

  async getTasks(): Promise<readonly ITask[]> {
    return this.loadTasks();
  }

  async getTasksSimple(): Promise<readonly ITask[]> {
    return this.loadTasks();
  }

  async getTaskCounts(): Promise<ITaskCounts> {
    const tasks = await this.loadTasks();
    const counts = { ...emptyTaskCounts() };
    for (const task of tasks) {
      const key = task.status in counts ? task.status : 'unknown';
      (counts as Record<string, number>)[key] += 1;
    }
    return counts;
  }

  async createTask(task: ITaskInput): Promise<ITask> {
    const tags = ['task', `status:${task.status ?? 'ready'}`];
    if (task.blocked) {
      for (const b of task.blocked) {
        tags.push(`blocked_by:${b}`);
      }
    }
    const entity = this.gitMem.remember(task.title, { tags });
    return toTask(entity);
  }

  async updateTask(taskId: string, updates: ITaskUpdate): Promise<ITask> {
    const existing = this.gitMem.get(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Delete old, create new with updated fields
    this.gitMem.delete(taskId);

    const title = updates.title ?? existing.content;
    const status = updates.status ?? getStatus(existing.tags);
    const blocked = updates.blocked ?? existing.tags
      .filter(t => t.startsWith('blocked_by:'))
      .map(t => t.replace('blocked_by:', ''));

    const tags = ['task', `status:${status}`];
    for (const b of blocked) {
      tags.push(`blocked_by:${b}`);
    }

    // Preserve non-task-specific tags from original
    for (const tag of existing.tags) {
      if (tag !== 'task' && !tag.startsWith('status:') && !tag.startsWith('blocked_by:')) {
        tags.push(tag);
      }
    }

    const entity = this.gitMem.remember(title, { tags });
    return toTask(entity);
  }

  private loadTasks(): ITask[] {
    const result = this.gitMem.recall(undefined, { tag: 'task', limit: 200 });
    return result.memories.map(toTask);
  }
}
