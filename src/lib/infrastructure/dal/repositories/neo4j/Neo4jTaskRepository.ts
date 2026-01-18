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
 */
interface Neo4jTaskRecord {
  key: string;
  status: string;
  title: string;
  blocked?: string[];
  created_at?: string;
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

    // Query for Task nodes in Graphiti's schema
    const cypher = `
      MATCH (n:Entity)
      WHERE n.group_id IN [${groupList}]
        AND n.name STARTS WITH 'Task:'
      RETURN n.uuid AS key, 
             n.status AS status,
             n.name AS title,
             n.blocked AS blocked,
             n.created_at AS created_at
      ORDER BY ${sortField} ${sortOrder}
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
   * Find a task by its key.
   */
  async findByKey(
    groupId: string,
    taskKey: string
  ): Promise<ITask | null> {
    const cypher = `
      MATCH (n:Entity)
      WHERE n.group_id = $groupId
        AND n.uuid = $taskKey
      RETURN n.uuid AS key,
             n.status AS status,
             n.name AS title,
             n.blocked AS blocked,
             n.created_at AS created_at
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
   */
  async findByStatus(
    groupIds: readonly string[],
    status: ITask['status'],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<ITaskQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit, offset, sort } = opts;

    const groupList = groupIds.map((g) => `"${g}"`).join(', ');
    const sortField = sort?.field === 'created_at' ? 'n.created_at' : 'n.title';
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    const cypher = `
      MATCH (n:Entity)
      WHERE n.group_id IN [${groupList}]
        AND n.name STARTS WITH 'Task:'
        AND n.status = $status
      RETURN n.uuid AS key,
             n.status AS status,
             n.name AS title,
             n.blocked AS blocked,
             n.created_at AS created_at
      ORDER BY ${sortField} ${sortOrder}
      SKIP ${offset}
      LIMIT ${limit}
    `;

    const records = await this.connection.query<Neo4jTaskRecord>(cypher, { status });
    const items = records.map(this.toTask);

    return {
      items,
      source: 'neo4j',
      hasMore: items.length === limit,
    };
  }

  /**
   * Get task counts by status using Cypher aggregation.
   */
  async getCounts(groupIds: readonly string[]): Promise<ITaskCounts> {
    const groupList = groupIds.map((g) => `"${g}"`).join(', ');

    const cypher = `
      MATCH (n:Entity)
      WHERE n.group_id IN [${groupList}]
        AND n.name STARTS WITH 'Task:'
      RETURN n.status AS status, count(n) AS count
    `;

    const records = await this.connection.query<{ status: string; count: number }>(cypher);

    // Use mutable object then cast to readonly
    const mutableCounts: Record<string, number> = {
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
    };

    for (const record of records) {
      const status = record.status;
      if (status in mutableCounts) {
        mutableCounts[status] = record.count;
      } else {
        mutableCounts.unknown += record.count;
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
   */
  private toTask(record: Neo4jTaskRecord): ITask {
    return {
      key: record.key,
      status: (record.status as ITask['status']) || 'unknown',
      title: record.title?.replace(/^Task:\s*/, '') || '',
      blocked: record.blocked || [],
      created_at: record.created_at,
    };
  }
}
