/**
 * Task service implementation for skill scripts.
 * Uses Neo4j for reads (always), MCP or Zep for writes.
 */
import type { INeo4jClient } from '../clients/interfaces/INeo4jClient';
import type { IMcpClient } from '../clients/interfaces/IMcpClient';
import type { IZepClient } from '../clients/interfaces/IZepClient';
import type {
  ITaskService,
  ITask,
  ITaskListResult,
  ITaskWriteResult,
  ITaskWriteOptions,
} from './interfaces';

/**
 * Neo4j record structure for task queries.
 */
interface Neo4jTaskRecord {
  uuid: string;
  name: string;
  group_id: string;
  created_at: string;
  content?: string;
}

/**
 * Dependencies for creating a task service.
 */
export interface ITaskServiceDependencies {
  neo4jClient: INeo4jClient;
  mcpClient: IMcpClient;
  zepClient: IZepClient | null;
}

/**
 * Creates a task service instance.
 *
 * @param deps - Service dependencies (clients)
 * @returns Task service implementation
 */
export function createTaskService(deps: ITaskServiceDependencies): ITaskService {
  const { neo4jClient, mcpClient, zepClient } = deps;

  return {
    async list(
      groupIds: string[],
      limit: number,
      defaultRepo: string,
      defaultAssignee: string
    ): Promise<ITaskListResult> {
      // Always use Neo4j for list (better date ordering)
      const groupList = groupIds.map((g) => `"${g}"`).join(', ');

      await neo4jClient.connect();
      try {
        const cypher = `
          MATCH (e:Episodic)
          WHERE e.group_id IN [${groupList}]
            AND (e.name STARTS WITH 'TASK:' OR e.content CONTAINS '"type":"task"' OR e.content CONTAINS '"type": "task"')
          RETURN e.uuid AS uuid, e.name AS name, e.group_id AS group_id,
                 e.created_at AS created_at, e.content AS content
          ORDER BY e.created_at DESC
          LIMIT ${limit}
        `;

        const records: Neo4jTaskRecord[] = await neo4jClient.query(cypher);

        // Parse tasks from episodic records
        const tasks: ITask[] = records.map((r: Neo4jTaskRecord) => {
          let taskObj: Record<string, unknown> | null = null;
          try {
            if (r.content) taskObj = JSON.parse(r.content);
          } catch {
            /* ignore parse errors */
          }

          if (taskObj && taskObj.type === 'task') {
            return {
              title: String(taskObj.title || ''),
              status: String(taskObj.status || 'unknown'),
              repo: String(taskObj.repo || defaultRepo),
              assignee: String(taskObj.assignee || defaultAssignee),
              notes: taskObj.notes ? String(taskObj.notes) : undefined,
              tag: taskObj.tag ? String(taskObj.tag) : null,
              uuid: r.uuid,
              created_at: r.created_at,
            };
          }

          // Fallback: extract title from name
          const title = r.name?.replace(/^TASK:\s*/, '') || 'Unknown task';
          return {
            title: title.slice(0, 120),
            status: 'unknown',
            repo: defaultRepo,
            assignee: defaultAssignee,
            uuid: r.uuid,
            created_at: r.created_at,
          };
        });

        return {
          status: 'ok',
          action: 'list',
          group: groupIds[0] || '',
          groups: groupIds,
          tasks,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
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
      };

      // Use Zep if available
      if (zepClient) {
        const result = await zepClient.addTask(groupId, taskObj);
        return {
          status: 'ok',
          action: 'add',
          task: taskObj,
          group: groupId,
          message_uuid: result.message_uuid,
          mode: 'zep-cloud',
        };
      }

      // Use MCP
      await mcpClient.initialize();
      const params = {
        name: `TASK: ${title.slice(0, 60)}`,
        episode_body: JSON.stringify(taskObj),
        source: 'json',
        group_id: groupId,
        tags: options.tag ? [options.tag] : undefined,
      };
      const result = await mcpClient.rpcCall<unknown>('add_memory', params);

      return {
        status: 'ok',
        action: 'add',
        task: taskObj,
        group: groupId,
        result,
        mode: 'mcp',
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
      };

      // Use Zep if available
      if (zepClient) {
        const result = await zepClient.addTask(groupId, taskObj);
        return {
          status: 'ok',
          action: 'update',
          task: taskObj,
          group: groupId,
          message_uuid: result.message_uuid,
          mode: 'zep-cloud',
        };
      }

      // Use MCP
      await mcpClient.initialize();
      const params = {
        name: `TASK UPDATE: ${title.slice(0, 60)}`,
        episode_body: JSON.stringify({ ...taskObj, updated: true }),
        source: 'json',
        group_id: groupId,
        tags: options.tag ? [options.tag] : undefined,
      };
      const result = await mcpClient.rpcCall<unknown>('add_memory', params);

      return {
        status: 'ok',
        action: 'update',
        task: taskObj,
        group: groupId,
        result,
        mode: 'mcp',
      };
    },
  };
}
