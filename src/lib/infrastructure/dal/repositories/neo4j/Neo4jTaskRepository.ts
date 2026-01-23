/**
 * Neo4j Task Repository
 *
 * Read-only task repository using direct Neo4j Cypher queries.
 * Optimized for task aggregations and status queries.
 */

import type { ITask, ITaskCounts } from '../../../../domain/interfaces/types/ITask';
import type {
  IReadOnlyTaskRepository,
  IQueryOptions,
  ITaskQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { Neo4jConnectionManager } from '../../connections/Neo4jConnectionManager';

/**
 * Raw Neo4j task record from Cypher query.
 * Supports both Episodic (new) and Entity (legacy) schemas.
 */
interface Neo4jTaskRecord {
  key: string;
  title: string;
  content?: string;  // JSON content for Episodic nodes
  status?: string;   // Direct status for Entity nodes
  blocked?: string[];
  created_at?: string;
}

/**
 * Parsed task content from Episodic JSON.
 */
interface TaskContent {
  type?: string;
  title?: string;
  status?: string;
  repo?: string;
  assignee?: string;
  notes?: string;
  tag?: string;
  externalLink?: {
    source: string;
    id: string;
    url: string;
    syncedAt?: string;
  };
}

/**
 * Neo4j Task Repository implementation.
 * Read-only: writes go through MCP.
 */
export class Neo4jTaskRepository implements IReadOnlyTaskRepository {
  constructor(private readonly connection: Neo4jConnectionManager) {}

  /**
   * Find tasks by group IDs.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<ITaskQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit, offset, sort } = opts;

    const groupList = groupIds.map((g) => `"${g}"`).join(', ');
    const sortField = sort?.field === 'created_at' ? 'n.created_at' : 'n.title';
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    // Query for Task episodic nodes in Graphiti's schema
    // Tasks are stored as Episodic nodes with name starting with 'TASK:' (uppercase)
    // and content containing JSON with type:"task"
    const cypher = `
      MATCH (e:Episodic)
      WHERE e.group_id IN [${groupList}]
        AND (e.name STARTS WITH 'TASK:' OR e.content CONTAINS '"type":"task"' OR e.content CONTAINS '"type": "task"')
      RETURN e.uuid AS key, 
             e.name AS title,
             e.content AS content,
             e.created_at AS created_at
      ORDER BY ${sortField.replace('n.', 'e.')} ${sortOrder}
      SKIP ${offset}
      LIMIT ${limit}
    `;

    const records = await this.connection.query<Neo4jTaskRecord>(cypher);
    const items = records.map(this.toTask);

    return {
      items,
      source: 'neo4j',
      hasMore: items.length === limit,
    };
  }

  /**
   * Find a task by its key (UUID).
   */
  async findByKey(
    groupId: string,
    taskKey: string
  ): Promise<ITask | null> {
    const cypher = `
      MATCH (e:Episodic)
      WHERE e.group_id = $groupId
        AND e.uuid = $taskKey
        AND (e.name STARTS WITH 'TASK:' OR e.content CONTAINS '"type":"task"')
      RETURN e.uuid AS key,
             e.name AS title,
             e.content AS content,
             e.created_at AS created_at
      LIMIT 1
    `;

    const records = await this.connection.query<Neo4jTaskRecord>(cypher, {
      groupId,
      taskKey,
    });

    return records.length > 0 ? this.toTask(records[0]) : null;
  }

  /**
   * Find tasks by status.
   * Note: Status filtering requires parsing JSON content, so we filter in JS.
   */
  async findByStatus(
    groupIds: readonly string[],
    status: ITask['status'],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<ITaskQueryResult> {
    const opts = applyQueryDefaults(options);
    const limitVal = opts.limit ?? 100;
    const offsetVal = opts.offset ?? 0;
    const sort = opts.sort;

    const groupList = groupIds.map((g) => `"${g}"`).join(', ');
    const sortField = sort?.field === 'created_at' ? 'e.created_at' : 'e.name';
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    // Fetch more than needed since we filter by status in JS
    const fetchLimit = (limitVal + offsetVal) * 2;

    const cypher = `
      MATCH (e:Episodic)
      WHERE e.group_id IN [${groupList}]
        AND (e.name STARTS WITH 'TASK:' OR e.content CONTAINS '"type":"task"')
      RETURN e.uuid AS key,
             e.name AS title,
             e.content AS content,
             e.created_at AS created_at
      ORDER BY ${sortField} ${sortOrder}
      LIMIT ${fetchLimit}
    `;

    const records = await this.connection.query<Neo4jTaskRecord>(cypher);
    const allItems = records.map(r => this.toTask(r));
    
    // Filter by status and apply pagination
    const filtered = allItems.filter(t => t.status === status);
    const items = filtered.slice(offsetVal, offsetVal + limitVal);

    return {
      items,
      source: 'neo4j',
      hasMore: filtered.length > offsetVal + limitVal,
    };
  }

  /**
   * Get task counts by status.
   * Since status is in JSON content, we need to parse and count in JS.
   */
  async getCounts(groupIds: readonly string[]): Promise<ITaskCounts> {
    const groupList = groupIds.map((g) => `"${g}"`).join(', ');

    const cypher = `
      MATCH (e:Episodic)
      WHERE e.group_id IN [${groupList}]
        AND (e.name STARTS WITH 'TASK:' OR e.content CONTAINS '"type":"task"')
      RETURN e.uuid AS key,
             e.name AS title,
             e.content AS content,
             e.created_at AS created_at
    `;

    const records = await this.connection.query<Neo4jTaskRecord>(cypher);
    const tasks = records.map(r => this.toTask(r));

    // Use mutable object then cast to readonly
    const mutableCounts: Record<string, number> = {
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
    };

    for (const task of tasks) {
      const status = task.status;
      if (status in mutableCounts) {
        mutableCounts[status]++;
      } else {
        mutableCounts.unknown++;
      }
    }

    return mutableCounts as unknown as ITaskCounts;
  }

  /**
   * Neo4j direct is read-only.
   */
  supportsWrite(): boolean {
    return false;
  }

  /**
   * Neo4j excels at aggregations.
   */
  supportsAggregation(): boolean {
    return true;
  }

  /**
   * Convert Neo4j record to ITask.
   * Handles both Episodic (JSON content) and Entity (direct fields) schemas.
   */
  private toTask(record: Neo4jTaskRecord): ITask {
    // Try to parse JSON content from Episodic nodes
    let content: TaskContent | null = null;
    if (record.content) {
      try {
        content = JSON.parse(record.content) as TaskContent;
      } catch {
        // Ignore parse errors, fall back to name-based extraction
      }
    }

    // If we have valid task content, use it
    if (content && content.type === 'task') {
      return {
        key: record.key,
        status: (content.status as ITask['status']) || 'unknown',
        title: content.title || record.title?.replace(/^TASK:\s*/i, '') || '',
        blocked: record.blocked || [],
        created_at: record.created_at,
      };
    }

    // Fall back to name-based extraction (legacy or TASK: prefix)
    return {
      key: record.key,
      status: (record.status as ITask['status']) || 'unknown',
      title: record.title?.replace(/^TASK:\s*/i, '').replace(/^Task:\s*/i, '') || '',
      blocked: record.blocked || [],
      created_at: record.created_at,
    };
  }
}
