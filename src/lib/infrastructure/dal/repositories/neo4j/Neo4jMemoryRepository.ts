/**
 * Neo4j Memory Repository
 *
 * Read-only memory repository using direct Neo4j Cypher queries.
 * Optimized for date-ordered listing and aggregations.
 */

import type { IMemoryItem } from '../../../../domain/interfaces/types/IMemoryResult';
import type {
  IReadOnlyMemoryRepository,
  IQueryOptions,
  IMemoryQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { Neo4jConnectionManager } from '../../connections/Neo4jConnectionManager';

/**
 * Raw Neo4j fact record from Cypher query.
 */
interface Neo4jFactRecord {
  uuid: string;
  group_id: string;
  name: string;
  fact: string;
  created_at: string;
  valid_at?: string;
  invalid_at?: string;
  expired_at?: string;
}

/**
 * Neo4j Memory Repository implementation.
 * Read-only: writes go through MCP for proper Graphiti ingestion.
 */
export class Neo4jMemoryRepository implements IReadOnlyMemoryRepository {
  constructor(private readonly connection: Neo4jConnectionManager) {}

  /**
   * Find facts by group IDs with optional filtering and sorting.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit, offset, sort, includeExpired, since, until } = opts;

    // Build Cypher query
    const groupList = groupIds.map((g) => `"${g}"`).join(', ');
    const sortField = `r.${sort?.field || 'created_at'}`;
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clauses
    const whereClauses: string[] = [
      `r.group_id IN [${groupList}]`,
      `r.fact IS NOT NULL`,
    ];

    if (!includeExpired) {
      whereClauses.push(`r.expired_at IS NULL`);
    }

    if (since) {
      whereClauses.push(`r.created_at >= datetime("${since.toISOString()}")`);
    }

    if (until) {
      whereClauses.push(`r.created_at <= datetime("${until.toISOString()}")`);
    }

    const whereClause = whereClauses.join(' AND ');

    const cypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE ${whereClause}
      RETURN r.uuid AS uuid, r.group_id AS group_id, r.name AS name,
             r.fact AS fact, r.created_at AS created_at,
             r.valid_at AS valid_at, r.invalid_at AS invalid_at,
             r.expired_at AS expired_at
      ORDER BY ${sortField} ${sortOrder}
      SKIP ${offset}
      LIMIT ${limit}
    `;

    const records = await this.connection.query<Neo4jFactRecord>(cypher);
    const items = records.map(this.toMemoryItem);

    return {
      items,
      source: 'neo4j',
      hasMore: items.length === limit,
    };
  }

  /**
   * Semantic search is NOT supported by Neo4j direct.
   * Throws an error - use MCP repository for semantic search.
   */
  async search(
    _groupIds: readonly string[],
    _query: string,
    _options?: Omit<IQueryOptions, 'query'>
  ): Promise<IMemoryQueryResult> {
    throw new Error(
      'Neo4j repository does not support semantic search. Use MCP repository instead.'
    );
  }

  /**
   * Find facts by tags.
   * Note: Tag filtering depends on how Graphiti stores tags in Neo4j.
   */
  async findByTags(
    groupIds: readonly string[],
    tags: readonly string[],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<IMemoryQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit, offset, sort, includeExpired } = opts;

    const groupList = groupIds.map((g) => `"${g}"`).join(', ');
    const tagList = tags.map((t) => `"${t}"`).join(', ');
    const sortField = `r.${sort?.field || 'created_at'}`;
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    const whereClauses: string[] = [
      `r.group_id IN [${groupList}]`,
      `r.fact IS NOT NULL`,
    ];

    if (!includeExpired) {
      whereClauses.push(`r.expired_at IS NULL`);
    }

    // Add tag filter - Graphiti may store tags differently
    // This assumes tags are stored in an array property
    if (tags.length > 0) {
      whereClauses.push(`ANY(tag IN [${tagList}] WHERE tag IN r.tags)`);
    }

    const whereClause = whereClauses.join(' AND ');

    const cypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE ${whereClause}
      RETURN r.uuid AS uuid, r.group_id AS group_id, r.name AS name,
             r.fact AS fact, r.created_at AS created_at,
             r.valid_at AS valid_at, r.invalid_at AS invalid_at,
             r.expired_at AS expired_at
      ORDER BY ${sortField} ${sortOrder}
      SKIP ${offset}
      LIMIT ${limit}
    `;

    const records = await this.connection.query<Neo4jFactRecord>(cypher);
    const items = records.map(this.toMemoryItem);

    return {
      items,
      source: 'neo4j',
      hasMore: items.length === limit,
    };
  }

  /**
   * Neo4j does not support semantic search.
   */
  supportsSemanticSearch(): boolean {
    return false;
  }

  /**
   * Neo4j excels at date-ordered queries.
   */
  supportsDateOrdering(): boolean {
    return true;
  }

  /**
   * Neo4j direct is read-only (writes go through MCP).
   */
  supportsWrite(): boolean {
    return false;
  }

  /**
   * Convert Neo4j record to IMemoryItem.
   */
  private toMemoryItem(record: Neo4jFactRecord): IMemoryItem {
    return {
      uuid: record.uuid,
      name: record.name,
      fact: record.fact,
      created_at: record.created_at,
    };
  }
}
