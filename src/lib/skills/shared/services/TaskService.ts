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
  ITaskLinkResult,
  ITaskExternalLink,
  ExternalLinkSource,
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
            const task: ITask = {
              title: String(taskObj.title || ''),
              status: String(taskObj.status || 'unknown'),
              repo: String(taskObj.repo || defaultRepo),
              assignee: String(taskObj.assignee || defaultAssignee),
              notes: taskObj.notes ? String(taskObj.notes) : undefined,
              tag: taskObj.tag ? String(taskObj.tag) : null,
              uuid: r.uuid,
              created_at: r.created_at,
            };
            // Include external link if present
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
        externalLink: options.externalLink ?? undefined,
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

      // Write directly to Neo4j (not MCP) for immediate persistence
      const uuid = `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const name = `TASK: ${title.slice(0, 60)}`;
      const content = JSON.stringify(taskObj);
      const createdAt = new Date().toISOString();

      await neo4jClient.connect();
      try {
        const cypher = `
          CREATE (e:Episodic {
            uuid: $uuid,
            name: $name,
            content: $content,
            group_id: $groupId,
            created_at: datetime($createdAt),
            source: 'lisa-cli',
            source_description: 'Task created via lisa tasks add'
          })
          RETURN e.uuid AS uuid
        `;
        await neo4jClient.query(cypher, { uuid, name, content, groupId, createdAt });

        return {
          status: 'ok',
          action: 'add',
          task: taskObj,
          group: groupId,
          result: { uuid, message: `Task created with uuid ${uuid}` },
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
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
      const storageObj = { ...taskObj };

      // Use Zep if available
      if (zepClient) {
        const result = await zepClient.addTask(groupId, storageObj);
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
        episode_body: JSON.stringify({ ...storageObj, updated: true }),
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

    async link(
      taskUuid: string,
      groupId: string,
      externalLink: ITaskExternalLink
    ): Promise<ITaskLinkResult> {
      // First, find the task by UUID to get its current data
      await neo4jClient.connect();
      
      try {
        const cypher = `
          MATCH (e:Episodic)
          WHERE e.uuid = $uuid
          RETURN e.uuid AS uuid, e.name AS name, e.content AS content
          LIMIT 1
        `;
        const records: Array<{ uuid: string; name: string; content?: string }> = 
          await neo4jClient.query(cypher, { uuid: taskUuid });

        if (records.length === 0) {
          throw new Error(`Task not found: ${taskUuid}`);
        }

        const record = records[0];
        let taskObj: Record<string, unknown> = { type: 'task', title: '' };
        
        if (record.content) {
          try {
            taskObj = JSON.parse(record.content);
          } catch {
            // Use name as fallback title
            taskObj.title = record.name?.replace(/^TASK:\s*/, '') || 'Unknown task';
          }
        }

        // Add the external link with sync timestamp
        taskObj.externalLink = {
          ...externalLink,
          syncedAt: new Date().toISOString(),
        };

        // Store the updated task
        if (zepClient) {
          await zepClient.addTask(groupId, taskObj);
          return {
            status: 'ok',
            action: 'link',
            task: {
              title: String(taskObj.title),
              uuid: taskUuid,
              externalLink: taskObj.externalLink as ITaskExternalLink,
            },
            group: groupId,
            mode: 'zep-cloud',
          };
        }

        // Use MCP
        await mcpClient.initialize();
        const params = {
          name: `TASK LINK: ${String(taskObj.title).slice(0, 50)} -> ${externalLink.source}#${externalLink.id}`,
          episode_body: JSON.stringify({ ...taskObj, linked: true }),
          source: 'json',
          group_id: groupId,
        };
        await mcpClient.rpcCall<unknown>('add_memory', params);

        return {
          status: 'ok',
          action: 'link',
          task: {
            title: String(taskObj.title),
            uuid: taskUuid,
            externalLink: taskObj.externalLink as ITaskExternalLink,
          },
          group: groupId,
          mode: 'mcp',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async unlink(
      taskUuid: string,
      groupId: string
    ): Promise<ITaskLinkResult> {
      // First, find the task by UUID
      await neo4jClient.connect();
      
      try {
        const cypher = `
          MATCH (e:Episodic)
          WHERE e.uuid = $uuid
          RETURN e.uuid AS uuid, e.name AS name, e.content AS content
          LIMIT 1
        `;
        const records: Array<{ uuid: string; name: string; content?: string }> = 
          await neo4jClient.query(cypher, { uuid: taskUuid });

        if (records.length === 0) {
          throw new Error(`Task not found: ${taskUuid}`);
        }

        const record = records[0];
        let taskObj: Record<string, unknown> = { type: 'task', title: '' };
        
        if (record.content) {
          try {
            taskObj = JSON.parse(record.content);
          } catch {
            taskObj.title = record.name?.replace(/^TASK:\s*/, '') || 'Unknown task';
          }
        }

        // Remove the external link
        delete taskObj.externalLink;

        // Store the updated task
        if (zepClient) {
          await zepClient.addTask(groupId, taskObj);
          return {
            status: 'ok',
            action: 'unlink',
            task: {
              title: String(taskObj.title),
              uuid: taskUuid,
            },
            group: groupId,
            mode: 'zep-cloud',
          };
        }

        // Use MCP
        await mcpClient.initialize();
        const params = {
          name: `TASK UNLINK: ${String(taskObj.title).slice(0, 60)}`,
          episode_body: JSON.stringify({ ...taskObj, unlinked: true }),
          source: 'json',
          group_id: groupId,
        };
        await mcpClient.rpcCall<unknown>('add_memory', params);

        return {
          status: 'ok',
          action: 'unlink',
          task: {
            title: String(taskObj.title),
            uuid: taskUuid,
          },
          group: groupId,
          mode: 'mcp',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async listLinked(
      groupIds: string[],
      source: ExternalLinkSource | undefined,
      limit: number,
      defaultRepo: string,
      defaultAssignee: string
    ): Promise<ITaskListResult> {
      // Get all tasks first, then filter by external link
      const result = await this.list(groupIds, limit * 2, defaultRepo, defaultAssignee);
      
      // Filter to only tasks with external links
      let linkedTasks = result.tasks.filter((t) => t.externalLink);
      
      // Further filter by source if specified
      if (source) {
        linkedTasks = linkedTasks.filter((t) => t.externalLink?.source === source);
      }

      // Apply limit
      linkedTasks = linkedTasks.slice(0, limit);

      return {
        ...result,
        tasks: linkedTasks,
      };
    },
  };
}
