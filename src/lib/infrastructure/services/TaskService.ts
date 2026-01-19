import type { ITaskService, IMcpClient, ITask, ITaskInput, ITaskUpdate, ITaskCounts, ILogger } from '../../domain';
import { ContextDetector } from '../context';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import { NullLogger } from '../logging';

interface McpTaskResponse {
  result?: {
    nodes?: Array<{
      uuid?: string;
      name?: string;
      fact?: string;
      tags?: string[];
      created_at?: string;
    }>;
  };
  nodes?: Array<{
    uuid?: string;
    name?: string;
    fact?: string;
    tags?: string[];
    created_at?: string;
  }>;
}

/**
 * Task service implementation.
 * Supports both direct MCP and DAL router backends.
 */
export class TaskService implements ITaskService {
  private readonly logger: ILogger;

  constructor(
    private readonly mcp: IMcpClient,
    private readonly router?: IRepositoryRouter,
    logger?: ILogger
  ) {
    this.logger = logger ?? new NullLogger();
  }

  /**
   * Get all tasks for a group.
   */
  async getTasks(
    groupIds: readonly string[],
    aliases: readonly string[],
    branch: string | null
  ): Promise<readonly ITask[]> {
    this.logger.debug('Getting tasks', { groupIds, aliases, branch });
    
    const tasks: ITask[] = [];
    const seenUuids = new Set<string>();

    for (const alias of aliases) {
      const taskParams = {
        query: 'task',
        tags: ['type:task', ...ContextDetector.repoTags({ repo: alias, branch })],
        max_nodes: 200,
        group_ids: [...groupIds],
      };

      const [taskResp] = await this.mcp.call<McpTaskResponse>('search_nodes', taskParams);

      const nodes = taskResp?.result?.nodes || taskResp?.nodes || [];

      for (const node of nodes) {
        const uuid = node.uuid || `${node.name}-${node.fact}`;
        if (seenUuids.has(uuid)) continue;
        seenUuids.add(uuid);

        const key = this.getTaskNum(node.tags) || this.getTaskId(node.tags);
        if (!key) continue;

        tasks.push({
          key,
          status: this.getTaskStatus(node.tags),
          title: node.name || node.fact || node.uuid || '<untitled>',
          blocked: (node.tags || [])
            .filter((t) => t.startsWith('blocked_by:'))
            .map((t) => t.replace('blocked_by:', '')),
          created_at: node.created_at,
        });
      }
    }

    // Sort by creation date descending
    tasks.sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });

    this.logger.info('Tasks loaded', { count: tasks.length });
    return tasks;
  }

  /**
   * Create a new task.
   */
  async createTask(groupId: string, task: ITaskInput): Promise<ITask> {
    this.logger.debug('Creating task', { groupId, title: task.title, status: task.status });
    
    const taskId = `task-${Date.now()}`;
    const tags = [
      'type:task',
      `task_id:${taskId}`,
      `status:${task.status || 'ready'}`,
    ];

    if (task.blocked) {
      task.blocked.forEach((b: string) => tags.push(`blocked_by:${b}`));
    }

    await this.mcp.call('add_memory', {
      content: task.title,
      group_ids: [groupId],
      tags,
    });

    this.logger.info('Task created', { taskId, status: task.status || 'ready' });
    
    return {
      key: taskId,
      status: task.status || 'ready',
      title: task.title,
      blocked: task.blocked || [],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Update an existing task.
   */
  async updateTask(groupId: string, taskId: string, updates: ITaskUpdate): Promise<ITask> {
    this.logger.debug('Updating task', { groupId, taskId, updates });
    
    const tags = ['type:task', `task_id:${taskId}`];

    if (updates.status) {
      tags.push(`status:${updates.status}`);
    }

    if (updates.blocked) {
      updates.blocked.forEach((b: string) => tags.push(`blocked_by:${b}`));
    }

    const content = updates.title || `Task ${taskId} updated`;

    await this.mcp.call('add_memory', {
      content,
      group_ids: [groupId],
      tags,
    });

    this.logger.info('Task updated', { taskId, status: updates.status });
    
    return {
      key: taskId,
      status: updates.status || 'unknown',
      title: updates.title || content,
      blocked: updates.blocked || [],
      created_at: new Date().toISOString(),
    };
  }

  // --- Helper methods ---

  private getTaskId(tags: readonly string[] = []): string | null {
    const t = tags.find((x) => x.startsWith('task_id:'));
    return t ? t.replace('task_id:', '') : null;
  }

  private getTaskNum(tags: readonly string[] = []): string | null {
    const t = tags.find((x) => x.startsWith('task_num:'));
    return t ? t.replace('task_num:', '') : null;
  }

  private getTaskStatus(tags: readonly string[] = []): ITask['status'] {
    const t = tags.find((x) => x.startsWith('status:'));
    const status = t ? t.replace('status:', '').toLowerCase() : 'unknown';
    const validStatuses = ['ready', 'in-progress', 'blocked', 'done', 'closed', 'unknown'];
    return validStatuses.includes(status) ? (status as ITask['status']) : 'unknown';
  }

  /**
   * Get task counts using DAL router (optimized for Neo4j).
   * Falls back to in-memory counting if router not available.
   */
  async getTaskCounts(groupIds: readonly string[]): Promise<ITaskCounts> {
    this.logger.debug('Getting task counts', { groupIds });
    
    if (this.router) {
      try {
        const repo = this.router.getTaskRepository('aggregate');
        if ('getCounts' in repo) {
          const counts = await repo.getCounts(groupIds);
          this.logger.debug('Task counts from DAL router', { counts });
          return counts;
        }
      } catch (error) {
        this.logger.debug('DAL router aggregate failed, falling back to in-memory', { 
          error: (error as Error).message 
        });
      }
    }

    // Fall back: load all tasks and count in memory
    const tasks = await this.getTasksSimple(groupIds);
    const counts: Record<string, number> = {
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
    };

    for (const task of tasks) {
      if (task.status in counts) {
        counts[task.status]++;
      } else {
        counts.unknown++;
      }
    }

    this.logger.debug('Task counts computed in-memory', { counts });
    return counts as unknown as ITaskCounts;
  }

  /**
   * Get tasks with simple interface (no aliases/branch).
   * Uses DAL router when available.
   */
  async getTasksSimple(groupIds: readonly string[]): Promise<readonly ITask[]> {
    this.logger.debug('Getting tasks (simple)', { groupIds });
    
    if (this.router) {
      try {
        const repo = this.router.getTaskRepository('list');
        const result = await repo.findByGroupIds(groupIds, {
          sort: { field: 'created_at', order: 'desc' },
          limit: 200,
        });
        this.logger.debug('Tasks loaded via DAL router', { count: result.items.length });
        return result.items;
      } catch (error) {
        this.logger.debug('DAL router list failed, falling back to MCP', { 
          error: (error as Error).message 
        });
      }
    }

    // Fall back to MCP path
    const [taskResp] = await this.mcp.call<McpTaskResponse>('search_nodes', {
      query: 'task',
      tags: ['type:task'],
      max_nodes: 200,
      group_ids: [...groupIds],
    });

    const nodes = taskResp?.result?.nodes || taskResp?.nodes || [];
    const tasks: ITask[] = [];

    for (const node of nodes) {
      const key = this.getTaskNum(node.tags) || this.getTaskId(node.tags);
      if (!key) continue;

      tasks.push({
        key,
        status: this.getTaskStatus(node.tags),
        title: node.name || node.fact || node.uuid || '<untitled>',
        blocked: (node.tags || [])
          .filter((t) => t.startsWith('blocked_by:'))
          .map((t) => t.replace('blocked_by:', '')),
        created_at: node.created_at,
      });
    }

    const sorted = tasks.sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });
    
    this.logger.debug('Tasks loaded via MCP', { count: sorted.length });
    return sorted;
  }
}
