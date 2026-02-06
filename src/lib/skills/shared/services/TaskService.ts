/**
 * Task service implementation for skill scripts.
 * Uses git-mem for all task operations.
 */
import type { IMemoryService as IGitMemMemoryService } from 'git-mem/dist/index';
import type {
  ITaskService,
  ITask,
  ITaskListResult,
  ITaskWriteResult,
  ITaskWriteOptions,
  ITaskLinkResult,
  ITaskExternalLink,
  ExternalLinkSource,
  ITaskLoadOptions,
} from './interfaces';

/**
 * Dependencies for creating a task service.
 */
export interface ITaskServiceDependencies {
  gitMem: IGitMemMemoryService;
}

/**
 * Parse a task object from a git-mem memory's content field.
 */
function parseTaskContent(content: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(content);
    if (obj && obj.type === 'task') return obj;
  } catch {
    /* not JSON - ignore */
  }
  return null;
}

/**
 * Creates a task service instance backed by git-mem.
 *
 * Tasks are stored as git-mem memories with:
 * - Tags: `task`, `group:<groupId>`, `status:<status>`, `task_id:<uuid>`
 * - Content: JSON `{ type: "task", title, status, repo, assignee, ... }`
 *
 * @param deps - Service dependencies
 * @returns Task service implementation
 */
export function createTaskService(deps: ITaskServiceDependencies): ITaskService {
  const { gitMem } = deps;

  return {
    async list(
      groupIds: string[],
      limit: number,
      defaultRepo: string,
      defaultAssignee: string,
      options?: ITaskLoadOptions
    ): Promise<ITaskListResult> {
      const { memories } = gitMem.recall(undefined, { limit: 500 });

      // Filter by group and task tag
      const groupTags = groupIds.map(g => `group:${g}`);
      let filtered = memories.filter(m =>
        m.tags.includes('task') &&
        (groupTags.length === 0 || m.tags.some(t => groupTags.includes(t)))
      );

      // Date filtering
      if (options?.since) {
        const sinceTime = options.since.getTime();
        filtered = filtered.filter(m => new Date(m.createdAt).getTime() >= sinceTime);
      }
      if (options?.until) {
        const untilTime = options.until.getTime();
        filtered = filtered.filter(m => new Date(m.createdAt).getTime() <= untilTime);
      }

      // Apply limit
      filtered = filtered.slice(0, limit);

      // Map to ITask
      const tasks: ITask[] = filtered.map(m => {
        const taskObj = parseTaskContent(m.content);

        if (taskObj) {
          const task: ITask = {
            title: String(taskObj.title || ''),
            status: String(taskObj.status || 'unknown'),
            repo: String(taskObj.repo || defaultRepo),
            assignee: String(taskObj.assignee || defaultAssignee),
            notes: taskObj.notes ? String(taskObj.notes) : undefined,
            tag: taskObj.tag ? String(taskObj.tag) : null,
            uuid: m.id,
            created_at: m.createdAt,
          };
          if (taskObj.externalLink && typeof taskObj.externalLink === 'object') {
            const link = taskObj.externalLink as Record<string, unknown>;
            task.externalLink = {
              source: String(link.source) as ExternalLinkSource,
              id: String(link.id),
              url: String(link.url),
              syncedAt: link.syncedAt ? String(link.syncedAt) : undefined,
            };
          }
          return task;
        }

        // Fallback: treat content as title
        return {
          title: m.content.slice(0, 120),
          status: 'unknown',
          repo: defaultRepo,
          assignee: defaultAssignee,
          uuid: m.id,
          created_at: m.createdAt,
        };
      });

      return {
        status: 'ok',
        action: 'list',
        group: groupIds[0] || '',
        groups: groupIds,
        tasks,
        mode: 'git-mem',
      };
    },

    async add(
      title: string,
      groupId: string,
      options: ITaskWriteOptions
    ): Promise<ITaskWriteResult> {
      const taskObj = {
        type: 'task' as const,
        title,
        status: options.status || 'todo',
        repo: options.repo || '',
        assignee: options.assignee || '',
        notes: options.notes,
        tag: options.tag,
        externalLink: options.externalLink ?? undefined,
      };

      const tags = [
        'task',
        `group:${groupId}`,
        `status:${taskObj.status}`,
      ];

      gitMem.remember(JSON.stringify(taskObj), { tags });

      return {
        status: 'ok',
        action: 'add',
        task: taskObj,
        group: groupId,
        mode: 'git-mem',
      };
    },

    async update(
      title: string,
      groupId: string,
      options: ITaskWriteOptions
    ): Promise<ITaskWriteResult> {
      const taskObj = {
        type: 'task' as const,
        title,
        status: options.status || 'todo',
        repo: options.repo || '',
        assignee: options.assignee || '',
        notes: options.notes,
        tag: options.tag,
        externalLink: options.externalLink ?? undefined,
      };

      // Find and delete old version(s) of this task by title
      const { memories } = gitMem.recall(undefined, { limit: 500 });
      const groupTag = `group:${groupId}`;
      const existing = memories.filter(m =>
        m.tags.includes('task') &&
        m.tags.includes(groupTag)
      );

      for (const m of existing) {
        const old = parseTaskContent(m.content);
        if (old && old.title === title) {
          gitMem.delete(m.id);
        }
      }

      // Remember updated version
      const tags = [
        'task',
        `group:${groupId}`,
        `status:${taskObj.status}`,
      ];

      gitMem.remember(JSON.stringify(taskObj), { tags });

      return {
        status: 'ok',
        action: 'update',
        task: taskObj,
        group: groupId,
        mode: 'git-mem',
      };
    },

    async link(
      taskUuid: string,
      groupId: string,
      externalLink: ITaskExternalLink
    ): Promise<ITaskLinkResult> {
      const { memories } = gitMem.recall(undefined, { limit: 500 });
      const existing = memories.find(m => m.id === taskUuid);

      if (!existing) {
        throw new Error(`Task not found: ${taskUuid}`);
      }

      const taskObj: Record<string, unknown> = parseTaskContent(existing.content) || {
        type: 'task',
        title: existing.content.slice(0, 120),
      };

      taskObj.externalLink = {
        ...externalLink,
        syncedAt: new Date().toISOString(),
      };

      // Delete old, remember updated
      gitMem.delete(taskUuid);
      const tags = existing.tags.length > 0 ? [...existing.tags] : [
        'task',
        `group:${groupId}`,
      ];
      gitMem.remember(JSON.stringify(taskObj), { tags });

      return {
        status: 'ok',
        action: 'link',
        task: {
          title: String(taskObj.title),
          uuid: taskUuid,
          externalLink: taskObj.externalLink as ITaskExternalLink,
        },
        group: groupId,
        mode: 'git-mem',
      };
    },

    async unlink(
      taskUuid: string,
      groupId: string
    ): Promise<ITaskLinkResult> {
      const { memories } = gitMem.recall(undefined, { limit: 500 });
      const existing = memories.find(m => m.id === taskUuid);

      if (!existing) {
        throw new Error(`Task not found: ${taskUuid}`);
      }

      const taskObj: Record<string, unknown> = parseTaskContent(existing.content) || {
        type: 'task',
        title: existing.content.slice(0, 120),
      };

      delete taskObj.externalLink;

      // Delete old, remember updated
      gitMem.delete(taskUuid);
      const tags = existing.tags.length > 0 ? [...existing.tags] : [
        'task',
        `group:${groupId}`,
      ];
      gitMem.remember(JSON.stringify(taskObj), { tags });

      return {
        status: 'ok',
        action: 'unlink',
        task: {
          title: String(taskObj.title),
          uuid: taskUuid,
        },
        group: groupId,
        mode: 'git-mem',
      };
    },

    async listLinked(
      groupIds: string[],
      source: ExternalLinkSource | undefined,
      limit: number,
      defaultRepo: string,
      defaultAssignee: string
    ): Promise<ITaskListResult> {
      const result = await this.list(groupIds, limit * 2, defaultRepo, defaultAssignee);

      let linkedTasks = result.tasks.filter((t) => t.externalLink);
      if (source) {
        linkedTasks = linkedTasks.filter((t) => t.externalLink?.source === source);
      }
      linkedTasks = linkedTasks.slice(0, limit);

      return {
        ...result,
        tasks: linkedTasks,
      };
    },
  };
}
