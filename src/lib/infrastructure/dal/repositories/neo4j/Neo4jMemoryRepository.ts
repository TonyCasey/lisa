/**
 * Neo4j Memory Repository
 *
 * Memory repository using direct Neo4j Cypher queries.
 * Supports reads, writes, expiration, and quality queries.
 * Serves as fallback write path when MCP is unavailable.
 */

import type { IMemoryItem } from '../../../../domain/interfaces/types/IMemoryResult';
import type {
  IMemoryRepositoryWriter,
  IMemoryRepositoryExpiration,
  IMemoryRepositoryQuality,
  IReadOnlyMemoryRepository,
  IMemorySaveOptions,
  IQueryOptions,
  IMemoryQueryResult,
  IExpirationFilter,
  IConflictGroup,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { resolveLifecycleTag } from '../../../../domain/interfaces/types/IMemoryLifecycle';
import type { ConfidenceLevel } from '../../../../domain/interfaces/types/IMemoryQuality';
import {
  CONFIDENCE_VALUES,
  CONFIDENCE_SCORES,
  resolveConfidenceTag,
} from '../../../../domain/interfaces/types/IMemoryQuality';
import { randomUUID } from 'node:crypto';
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
 * Neo4j count result from Cypher COUNT query.
 */
interface Neo4jCountRecord {
  count: number;
}

/**
 * Neo4j Memory Repository implementation.
 * Supports reads, writes, expiration, and quality queries.
 * Writes create Entity nodes and relationships matching the Graphiti schema.
 */
export class Neo4jMemoryRepository
  implements IReadOnlyMemoryRepository, IMemoryRepositoryWriter, IMemoryRepositoryExpiration, IMemoryRepositoryQuality
{
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
   * Save a new fact to memory.
   * Creates Entity nodes and a relationship with fact properties.
   */
  async save(
    groupId: string,
    content: string,
    options?: IMemorySaveOptions
  ): Promise<IMemoryItem> {
    const name = content.slice(0, 80);
    const tag = options?.tags?.[0] ?? 'RELATES_TO';
    // Derive a stable target entity name from the tag or content
    const targetName = `fact-${tag.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    const uuid = randomUUID();

    const cypher = `
      MERGE (s:Entity {name: $sourceName})
      ON CREATE SET s.group_id = $groupId, s.created_at = datetime()
      MERGE (t:Entity {name: $targetName})
      ON CREATE SET t.group_id = $groupId, t.created_at = datetime()
      CREATE (s)-[:RELATES_TO {
        uuid: $uuid,
        group_id: $groupId,
        name: $name,
        fact: $content,
        created_at: datetime(),
        valid_at: datetime()
      }]->(t)
    `;

    const params = {
      uuid,
      sourceName: groupId,
      targetName,
      groupId,
      name,
      content,
    };

    await this.connection.write(cypher, params);

    return {
      uuid,
      name,
      fact: content,
      tags: options?.tags ? [...options.tags] : undefined,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Save multiple facts in batch with concurrency limit.
   */
  async saveBatch(
    groupId: string,
    facts: readonly string[],
    options?: IMemorySaveOptions
  ): Promise<readonly IMemoryItem[]> {
    const CONCURRENCY_LIMIT = 5;
    const results: IMemoryItem[] = [];

    for (let i = 0; i < facts.length; i += CONCURRENCY_LIMIT) {
      const batch = facts.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map((content) => this.save(groupId, content, options))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Expire a single fact by UUID.
   * Sets expired_at timestamp on the matching relationship.
   */
  async expire(groupId: string, uuid: string): Promise<void> {
    const cypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
      SET r.expired_at = datetime()
    `;
    await this.connection.write(cypher, { groupId, uuid });
  }

  /**
   * Expire facts matching a filter.
   * Uses count-then-write: READ session for count, WRITE session for expiration.
   * @returns Number of facts expired
   */
  async expireByFilter(groupId: string, filter: IExpirationFilter): Promise<number> {
    const whereClauses: string[] = [
      `r.group_id = $groupId`,
      `r.fact IS NOT NULL`,
      `r.expired_at IS NULL`,
    ];
    const params: Record<string, unknown> = { groupId };

    if (filter.lifecycle) {
      const lifecycleTag = resolveLifecycleTag(filter.lifecycle);
      whereClauses.push(`$lifecycleTag IN r.tags`);
      params.lifecycleTag = lifecycleTag;
    }

    if (filter.olderThan) {
      whereClauses.push(`r.created_at <= datetime($olderThan)`);
      params.olderThan = filter.olderThan.toISOString();
    }

    if (filter.tags && filter.tags.length > 0) {
      whereClauses.push(`ANY(tag IN $filterTags WHERE tag IN r.tags)`);
      params.filterTags = [...filter.tags];
    }

    const whereClause = whereClauses.join(' AND ');

    // Step 1: Count matching facts (READ session)
    const countCypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE ${whereClause}
      RETURN count(r) AS count
    `;
    const countResult = await this.connection.query<Neo4jCountRecord>(countCypher, params);
    const count = countResult[0]?.count ?? 0;

    if (count === 0) {
      return 0;
    }

    // Step 2: Expire matching facts (WRITE session)
    const expireCypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE ${whereClause}
      SET r.expired_at = datetime()
    `;
    await this.connection.write(expireCypher, params);

    return count;
  }

  /**
   * Find facts at or above a minimum confidence level.
   * Filters by confidence:* tags using CONFIDENCE_SCORES ordering.
   */
  async findByMinConfidence(
    groupIds: readonly string[],
    minLevel: ConfidenceLevel,
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult> {
    const opts = applyQueryDefaults(options);
    const { limit, offset, sort, includeExpired } = opts;

    // Build list of confidence tags at or above the minimum level
    const minScore = CONFIDENCE_SCORES[minLevel];
    const acceptedTags = CONFIDENCE_VALUES
      .filter((level) => CONFIDENCE_SCORES[level] >= minScore)
      .map(resolveConfidenceTag);

    const sortField = `r.${sort?.field || 'created_at'}`;
    const sortOrder = sort?.order === 'asc' ? 'ASC' : 'DESC';

    const params: Record<string, unknown> = {
      groupIds: [...groupIds],
      acceptedTags: [...acceptedTags],
      offset,
      limit,
    };

    const whereClauses: string[] = [
      `r.group_id IN $groupIds`,
      `r.fact IS NOT NULL`,
      `ANY(tag IN r.tags WHERE tag IN $acceptedTags)`,
    ];

    if (!includeExpired) {
      whereClauses.push(`r.expired_at IS NULL`);
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
      SKIP $offset
      LIMIT $limit
    `;

    const records = await this.connection.query<Neo4jFactRecord>(cypher, params);
    const items = records.map(this.toMemoryItem);

    return {
      items,
      source: 'neo4j',
      hasMore: items.length === limit,
    };
  }

  /**
   * Find groups of potentially conflicting facts.
   * Detects facts sharing a type:* tag but with differing content.
   */
  async findConflicts(
    groupIds: readonly string[],
    topic?: string,
    options?: IQueryOptions
  ): Promise<readonly IConflictGroup[]> {
    const opts = applyQueryDefaults(options);
    const { limit, includeExpired } = opts;

    const params: Record<string, unknown> = {
      groupIds: [...groupIds],
      limit,
    };

    const whereClauses: string[] = [
      `r.group_id IN $groupIds`,
      `r.fact IS NOT NULL`,
      `ANY(tag IN r.tags WHERE tag STARTS WITH 'type:')`,
    ];

    if (!includeExpired) {
      whereClauses.push(`r.expired_at IS NULL`);
    }

    if (topic) {
      whereClauses.push(`$topic IN r.tags`);
      params.topic = topic;
    }

    const whereClause = whereClauses.join(' AND ');

    const cypher = `
      MATCH (s:Entity)-[r]->(t:Entity)
      WHERE ${whereClause}
      WITH [tag IN r.tags WHERE tag STARTS WITH 'type:' | tag][0] AS topicTag,
           r.uuid AS uuid, r.name AS name, r.fact AS fact,
           r.group_id AS group_id, r.created_at AS created_at
      WITH topicTag, COLLECT({ uuid: uuid, name: name, fact: fact, group_id: group_id, created_at: created_at }) AS facts
      WHERE SIZE(facts) > 1
      RETURN topicTag, facts
      LIMIT $limit
    `;

    const records = await this.connection.query<{
      topicTag: string;
      facts: Array<{ uuid: string; name: string; fact: string; group_id: string; created_at: string }>;
    }>(cypher, params);

    return records.map((record) => ({
      topic: record.topicTag,
      facts: record.facts.map((f) => ({
        uuid: f.uuid,
        name: f.name,
        fact: f.fact,
        created_at: f.created_at,
      })),
      detectedAt: new Date().toISOString(),
    }));
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
   * Neo4j supports direct writes as fallback when MCP is unavailable.
   */
  supportsWrite(): boolean {
    return true;
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
