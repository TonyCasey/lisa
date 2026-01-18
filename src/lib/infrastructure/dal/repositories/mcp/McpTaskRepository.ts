/**
 * MCP Task Repository
 *
 * Task repository using Graphiti MCP server.
 * Supports full CRUD operations on tasks.
 */

import type { ITask, ITaskInput, ITaskUpdate, ITaskCounts } from '../../../../domain/interfaces/types/ITask';
import type {
  ITaskRepository,
  IQueryOptions,
  ITaskQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { McpConnectionManager } from '../../connections/McpConnectionManager';

/**
 * MCP node response structure.
 */
interface McpNodesResponse {
  nodes?: McpNode[];
  result?: {
    nodes?: McpNode[];
  };
}

/**
 * MCP node structure (tasks are stored as nodes).
 */
interface McpNode {
  uuid?: string;
  name?: string;
  status?: string;
  blocked?: string[];
  created_at?: string;
  group_id?: string;
}

/**
 * MCP Task Repository implementation.
 * Full CRUD support via Graphiti MCP.
 */
export class McpTaskRepository implements ITaskRepository {
  constructor(private readonly connection: McpConnectionManager) {}

  /**
   * Find tasks by group IDs.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<ITaskQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit } = opts;

    const params: Record<string, unknown> = {
      query: 'Task:',
      max_nodes: limit,
      group_ids: [...groupIds],
    };

    const response = await this.connection.call<McpNodesResponse>(
      'search_nodes',
      params
    );

    const nodes = response?.nodes || response?.result?.nodes || [];
    const tasks = nodes
      .filter((n) => n.name?.startsWith('Task:'))
      .map(this.toTask);

    // Sort by created_at descending
    tasks.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

    return {
      items: tasks.slice(0, limit),
      source: 'mcp',
      hasMore: tasks.length > limit!,
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
      source: 'mcp',
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
   * Create a new task.
   */
  async create(groupId: string, task: ITaskInput): Promise<ITask> {
    const taskName = `Task: ${task.title}`;

    const params: Record<string, unknown> = {
      name: taskName,
      episode_body: `Created task: ${task.title}`,
      group_id: groupId,
      source: 'lisa-dal',
    };

    await this.connection.call('add_memory', params);

    // Return the created task (MCP doesn't return the full object)
    return {
      key: `task-${Date.now()}`, // Placeholder - real key comes from MCP
      status: task.status || 'ready',
      title: task.title,
      blocked: task.blocked || [],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Update a task.
   * Note: Graphiti MCP may not support direct task updates.
   */
  async update(
    groupId: string,
    taskKey: string,
    updates: ITaskUpdate
  ): Promise<ITask> {
    // Find existing task
    const existing = await this.findByKey(groupId, taskKey);
    if (!existing) {
      throw new Error(`Task not found: ${taskKey}`);
    }

    // Create an update episode
    const updateText = [
      `Updated task: ${existing.title}`,
      updates.status ? `Status: ${updates.status}` : null,
      updates.title ? `New title: ${updates.title}` : null,
      updates.blocked?.length ? `Blocked by: ${updates.blocked.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('. ');

    await this.connection.call('add_memory', {
      name: `Task Update: ${existing.title}`,
      episode_body: updateText,
      group_id: groupId,
      source: 'lisa-dal',
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
   * Delete a task.
   * Note: Graphiti MCP may not support direct deletion.
   */
  async delete(groupId: string, taskKey: string): Promise<void> {
    const existing = await this.findByKey(groupId, taskKey);
    if (!existing) {
      return; // Already deleted
    }

    // Mark as closed via update
    await this.update(groupId, taskKey, { status: 'closed' });
  }

  /**
   * MCP supports write operations.
   */
  supportsWrite(): boolean {
    return true;
  }

  /**
   * MCP supports aggregation (via client-side counting).
   */
  supportsAggregation(): boolean {
    return true;
  }

  /**
   * Convert MCP node to ITask.
   */
  private toTask(node: McpNode): ITask {
    return {
      key: node.uuid || '',
      status: (node.status as ITask['status']) || 'unknown',
      title: node.name?.replace(/^Task:\s*/, '') || '',
      blocked: node.blocked || [],
      created_at: node.created_at,
    };
  }
}
