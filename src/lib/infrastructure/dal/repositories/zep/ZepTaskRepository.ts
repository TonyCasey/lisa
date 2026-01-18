/**
 * Zep Cloud Task Repository
 *
 * Task repository using Zep Cloud REST API.
 * Note: Zep's primary focus is memory/facts, so task support is limited.
 */

import type { ITask, ITaskInput, ITaskUpdate, ITaskCounts } from '../../../../domain/interfaces/types/ITask';
import type {
  ITaskRepository,
  IQueryOptions,
  ITaskQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { ZepConnectionManager } from '../../connections/ZepConnectionManager';

/**
 * Zep search response for task-related facts.
 */
interface ZepSearchResponse {
  edges?: ZepEdge[];
}

interface ZepEdge {
  uuid?: string;
  name?: string;
  fact?: string;
  created_at?: string;
}

/**
 * Zep Cloud Task Repository implementation.
 * Tasks are stored as facts with "Task:" prefix.
 */
export class ZepTaskRepository implements ITaskRepository {
  constructor(private readonly connection: ZepConnectionManager) {}

  /**
   * Find tasks by group IDs.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<ITaskQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit } = opts;

    const allTasks: ITask[] = [];

    for (const groupId of groupIds) {
      const userId = `lisa-${groupId}`;

      try {
        const response = await this.connection.fetch<ZepSearchResponse>('/graph/search', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            query: 'Task:',
            limit: Math.ceil(limit! / groupIds.length),
            search_scope: 'facts',
          }),
        });

        const edges = response.edges || [];
        const tasks = edges
          .filter((e) => e.name?.startsWith('Task:') || e.fact?.startsWith('Task:'))
          .map(this.edgeToTask);
        allTasks.push(...tasks);
      } catch {
        // Group might not exist
      }
    }

    // Sort by created_at descending
    allTasks.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

    return {
      items: allTasks.slice(0, limit),
      source: 'zep',
      hasMore: allTasks.length > limit!,
    };
  }

  /**
   * Find a task by its key.
   */
  async findByKey(
    groupId: string,
    taskKey: string
  ): Promise<ITask | null> {
    const result = await this.findByGroupIds([groupId], { limit: 100 });
    return result.items.find((t) => t.key === taskKey) || null;
  }

  /**
   * Find tasks by status.
   */
  async findByStatus(
    groupIds: readonly string[],
    status: ITask['status'],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<ITaskQueryResult> {
    const result = await this.findByGroupIds(groupIds, options);
    const filtered = result.items.filter((t) => t.status === status);

    return {
      items: filtered,
      source: 'zep',
      hasMore: false,
    };
  }

  /**
   * Get task counts by status.
   */
  async getCounts(groupIds: readonly string[]): Promise<ITaskCounts> {
    const result = await this.findByGroupIds(groupIds, { limit: 1000 });

    const counts: Record<string, number> = {
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
    };

    for (const task of result.items) {
      if (task.status in counts) {
        counts[task.status]++;
      } else {
        counts.unknown++;
      }
    }

    return counts as unknown as ITaskCounts;
  }

  /**
   * Create a new task via Zep message.
   */
  async create(groupId: string, task: ITaskInput): Promise<ITask> {
    const userId = `lisa-${groupId}`;
    const threadId = `lisa-tasks-${groupId}`;

    await this.connection.ensureUser(userId);
    await this.connection.getOrCreateThread(threadId, userId);

    const taskText = `Task: ${task.title} [status:${task.status || 'ready'}]`;

    await this.connection.fetch(`/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            role_type: 'user',
            content: `[lisa-dal] ${taskText}`,
          },
        ],
      }),
    });

    return {
      key: `task-${Date.now()}`,
      status: task.status || 'ready',
      title: task.title,
      blocked: task.blocked || [],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Update a task.
   */
  async update(
    groupId: string,
    taskKey: string,
    updates: ITaskUpdate
  ): Promise<ITask> {
    const existing = await this.findByKey(groupId, taskKey);
    if (!existing) {
      throw new Error(`Task not found: ${taskKey}`);
    }

    const _userId = `lisa-${groupId}`; // For future user-scoped updates
    const threadId = `lisa-tasks-${groupId}`;

    const updateText = [
      `Task Update: ${existing.title}`,
      updates.status ? `status:${updates.status}` : null,
      updates.title ? `title:${updates.title}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    await this.connection.fetch(`/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            role_type: 'user',
            content: `[lisa-dal] ${updateText}`,
          },
        ],
      }),
    });

    return {
      ...existing,
      ...updates,
      key: taskKey,
      title: updates.title || existing.title,
      status: updates.status || existing.status,
      blocked: updates.blocked || existing.blocked,
    };
  }

  /**
   * Delete a task (mark as closed).
   */
  async delete(groupId: string, taskKey: string): Promise<void> {
    await this.update(groupId, taskKey, { status: 'closed' });
  }

  /**
   * Zep supports write operations.
   */
  supportsWrite(): boolean {
    return true;
  }

  /**
   * Zep supports aggregation via client-side counting.
   */
  supportsAggregation(): boolean {
    return true;
  }

  /**
   * Convert Zep edge to ITask.
   */
  private edgeToTask(edge: ZepEdge): ITask {
    const text = edge.fact || edge.name || '';
    const title = text.replace(/^Task:\s*/, '').replace(/\s*\[status:\w+\]$/, '');

    // Extract status from fact text if present
    const statusMatch = text.match(/\[status:(\w+)\]/);
    const status = (statusMatch?.[1] as ITask['status']) || 'unknown';

    return {
      key: edge.uuid || '',
      status,
      title,
      blocked: [],
      created_at: edge.created_at,
    };
  }
}
