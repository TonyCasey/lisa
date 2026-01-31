/**
 * Neo4j Memory Repository
 *
 * Read-only memory repository using direct Neo4j Cypher queries.
 * Optimized for date-ordered listing and aggregations.
 */

import type { IMemoryItem } from '../../../../domain/interfaces/types/IMemoryResult';
import type {
  IReadOnlyMemoryRepositoryWithQuality,
  IQueryOptions,
  IMemoryQueryResult,
  IExpirationFilter,
  IConflictGroup,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { resolveLifecycleTag } from '../../../../domain/interfaces/types/IMemoryLifecycle';
import type { ConfidenceLevel } from '../../../../domain/interfaces/types/IMemoryQuality';
import {
  CONFIDENCE_SCORES,
  parseConfidenceTag,
} from '../../../../domain/interfaces/types/IMemoryQuality';
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
  tags?: string[];
}

/**
 * Neo4j count result from Cypher COUNT query.
 */
interface Neo4jCountRecord {
  count: number;
}

/**
 * Neo4j Memory Repository implementation.
 * Read-only with expiration support: writes go through MCP for proper Graphiti ingestion.
 */
export class Neo4jMemoryRepository implements IReadOnlyMemoryRepositoryWithQuality {
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
             r.expired_at AS expired_at, r.tags AS tags
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
             r.expired_at AS expired_at, r.tags AS tags
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
   * Find facts at or above a minimum confidence level.
   * Loads facts with tags and filters client-side by confidence score.
   */
  async findByMinConfidence(
    groupIds: readonly string[],
    minLevel: ConfidenceLevel,
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult> {
    // Load a larger set since we filter client-side.
    // Account for offset: we need enough records to cover offset + limit after filtering.
    const opts = applyQueryDefaults(options);
    const limit = opts.limit ?? 10;
    const offset = opts.offset ?? 0;
    const fetchLimit = (offset + limit) * 3;
    const result = await this.findByGroupIds(groupIds, { ...opts, limit: fetchLimit, offset: 0 });

    const minScore = CONFIDENCE_SCORES[minLevel];
    const filtered = result.items.filter((item) => {
      const tags = item.tags ?? [];
      const level = parseConfidenceTag(tags);
      if (!level) {
        // Facts without confidence tag don't meet the threshold
        return false;
      }
      return CONFIDENCE_SCORES[level] >= minScore;
    });

    const items = filtered.slice(offset, offset + limit);
    return {
      items,
      source: 'neo4j',
      hasMore: result.hasMore || filtered.length > offset + limit,
    };
  }

  /**
   * Find groups of potentially conflicting facts.
   * Groups facts by shared topic tags (excluding utility tags) and identifies
   * groups where facts have differing content.
   */
  async findConflicts(
    groupIds: readonly string[],
    topic?: string,
    options?: IQueryOptions
  ): Promise<readonly IConflictGroup[]> {
    // Load facts to analyze
    const opts = applyQueryDefaults(options);
    const result = await this.findByGroupIds(groupIds, { ...opts, limit: 200 });

    // Utility tag prefixes to exclude from topic grouping
    const utilityPrefixes = ['lifecycle:', 'confidence:', 'source:', 'type:'];

    // Group facts by their topic tags
    const topicGroups = new Map<string, IMemoryItem[]>();
    for (const item of result.items) {
      const tags = item.tags ?? [];
      const topicTags = tags.filter(
        (t) => !utilityPrefixes.some((prefix) => t.startsWith(prefix))
      );

      // If topic filter specified, only include facts with matching tags
      if (topic) {
        const hasMatchingTag = topicTags.some((t) =>
          t.toLowerCase().includes(topic.toLowerCase())
        );
        if (!hasMatchingTag) {
          continue;
        }
      }

      for (const tag of topicTags) {
        const existing = topicGroups.get(tag) ?? [];
        existing.push(item);
        topicGroups.set(tag, existing);
      }
    }

    // Find groups where facts have differing content
    const conflicts: IConflictGroup[] = [];
    const now = new Date().toISOString();

    for (const [tag, facts] of topicGroups) {
      if (facts.length < 2) {
        continue;
      }

      // Check if facts in this group have different content
      const uniqueContents = new Set(facts.map((f) => f.fact));
      if (uniqueContents.size > 1) {
        conflicts.push({
          topic: tag,
          facts,
          detectedAt: now,
        });
      }
    }

    return conflicts;
  }

  /**
   * Convert Neo4j record to IMemoryItem.
   */
  private toMemoryItem(record: Neo4jFactRecord): IMemoryItem {
    return {
      uuid: record.uuid,
      name: record.name,
      fact: record.fact,
      tags: record.tags,
      created_at: record.created_at,
    };
  }
}
