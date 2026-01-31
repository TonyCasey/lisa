/**
 * Memory service implementation for skill scripts.
 * Uses Neo4j for reads (always), MCP or Zep for writes.
 */
import type { INeo4jClient } from '../clients/interfaces/INeo4jClient';
import type { IMcpClient } from '../clients/interfaces/IMcpClient';
import type { IZepClient } from '../clients/interfaces/IZepClient';
import type {
  IMemoryService,
  IFact,
  IMemoryLoadResult,
  IMemoryAddResult,
  IMemoryAddOptions,
  IMemoryLoadOptions,
  IMemoryExpireResult,
  IMemoryCleanupResult,
  IMemoryVerifyResult,
  IMemoryCurateResult,
  IMemoryConflictsResult,
  ICurateOptions,
  ICurateFact,
} from './interfaces';
import { LIFECYCLE_DEFAULTS, resolveLifecycleTag } from '../../../domain/interfaces/types/IMemoryLifecycle';
import type { MemoryLifecycle } from '../../../domain/interfaces/types/IMemoryLifecycle';
import {
  resolveConfidenceTag,
  resolveSourceTag,
  parseConfidenceTag,
  parseSourceTag,
  CONFIDENCE_SCORES,
} from '../../../domain/interfaces/types/IMemoryQuality';
import type { ConfidenceLevel } from '../../../domain/interfaces/types/IMemoryQuality';
import { parseDate } from '../../../utils/dateParser';
import { MemoryError } from '../../../domain/errors/LisaError';

/**
 * Neo4j record structure for fact queries.
 */
interface Neo4jFactRecord {
  uuid: string;
  name: string;
  fact: string;
  group_id: string;
  created_at: string;
  valid_at?: string;
  expired_at?: string | null;
  tags?: string[];
}

/**
 * Dependencies for creating a memory service.
 */
export interface IMemoryServiceDependencies {
  neo4jClient: INeo4jClient;
  mcpClient: IMcpClient;
  zepClient: IZepClient | null;
}

/**
 * Type-to-tag mapping for memory types.
 */
const TYPE_TAG_MAP: Record<string, string> = {
  decision: 'DECISION',
  pattern: 'PATTERN',
  bug: 'BUG',
  milestone: 'MILESTONE',
  feature: 'FEATURE',
  refactor: 'REFACTOR',
  context: 'CONTEXT',
  learning: 'LEARNING',
};

/**
 * Resolve a tag from the memory type or explicit tag.
 */
function resolveTag(text: string, options: IMemoryAddOptions): string | undefined {
  if (options.tag) return options.tag;
  if (options.type && TYPE_TAG_MAP[options.type.toLowerCase()]) {
    return TYPE_TAG_MAP[options.type.toLowerCase()];
  }
  const prefixMatch = text.match(/^([A-Z_]+):\s*/);
  if (prefixMatch) {
    return prefixMatch[1];
  }
  return undefined;
}

/**
 * Format a duration from milliseconds into human-readable string.
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * Parse lifecycle from tags array.
 */
function parseLifecycleTag(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith('lifecycle:')) {
      return tag.slice('lifecycle:'.length);
    }
  }
  return null;
}

/**
 * Creates a memory service instance.
 */
export function createMemoryService(deps: IMemoryServiceDependencies): IMemoryService {
  const { neo4jClient, mcpClient, zepClient } = deps;

  return {
    async load(
      groupIds: string[],
      query: string,
      limit: number,
      options?: IMemoryLoadOptions
    ): Promise<IMemoryLoadResult> {
      const params: Record<string, unknown> = {
        groupIds,
        limit: Math.floor(limit),
      };

      const dateFilters: string[] = [];

      if (options?.since) {
        dateFilters.push('r.created_at >= datetime($since)');
        params.since = options.since.toISOString();
      }
      if (options?.until) {
        dateFilters.push('r.created_at <= datetime($until)');
        params.until = options.until.toISOString();
      }

      // Confidence filter - client-side post-filter
      const minConfidence = options?.minConfidence;
      // Fetch more if filtering, to compensate for client-side removal
      const fetchLimit = minConfidence ? Math.floor(limit) * 3 : Math.floor(limit);
      params.limit = fetchLimit;

      const dateFilterClause = dateFilters.length > 0 ? `AND ${dateFilters.join(' AND ')}` : '';

      await neo4jClient.connect();
      try {
        let cypher: string;

        if (query && query !== '*') {
          params.query = query;
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN $groupIds
              AND r.expired_at IS NULL
              AND (r.fact CONTAINS $query OR r.name CONTAINS $query)
              ${dateFilterClause}
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at,
                   r.tags AS tags
            ORDER BY r.created_at DESC
            LIMIT $limit
          `;
        } else {
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN $groupIds
              AND r.expired_at IS NULL
              ${dateFilterClause}
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at,
                   r.tags AS tags
            ORDER BY r.created_at DESC
            LIMIT $limit
          `;
        }

        const records: Neo4jFactRecord[] = await neo4jClient.query(cypher, params);

        let facts: IFact[] = records.map((r: Neo4jFactRecord) => ({
          uuid: r.uuid,
          name: r.name,
          fact: r.fact,
          group_id: r.group_id,
          created_at: r.created_at,
          valid_at: r.valid_at,
          expired_at: r.expired_at,
          tags: r.tags,
        }));

        // Client-side confidence filter
        if (minConfidence) {
          const minScore = CONFIDENCE_SCORES[minConfidence];
          facts = facts.filter(f => {
            const factConfidence = parseConfidenceTag(f.tags ?? []);
            if (!factConfidence) return false; // No confidence = excluded
            return CONFIDENCE_SCORES[factConfidence] >= minScore;
          });
          facts = facts.slice(0, limit); // Trim to original limit
        }

        // Strip tags from output unless showMetadata is requested
        if (!options?.showMetadata) {
          facts = facts.map(f => {
            const { tags: _tags, ...rest } = f;
            return rest as IFact;
          });
        }

        return {
          status: 'ok',
          action: 'load',
          group: groupIds[0] || '',
          groups: groupIds,
          query: query || '',
          facts,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async add(
      text: string,
      groupId: string,
      options: IMemoryAddOptions
    ): Promise<IMemoryAddResult> {
      const tag = resolveTag(text, options);

      // Build additional quality tags
      const qualityTags: string[] = [];
      if (options.confidence) {
        qualityTags.push(resolveConfidenceTag(options.confidence));
      }
      if (options.sourceType) {
        qualityTags.push(resolveSourceTag(options.sourceType));
      }

      if (zepClient) {
        const result = await zepClient.addMemory(groupId, text, {
          tag,
          source: options.source,
        });

        return {
          status: 'ok',
          action: 'add',
          group: groupId,
          text,
          tag,
          message_uuid: result.message_uuid,
          mode: 'zep-cloud',
        };
      }

      await mcpClient.initialize();
      const mcpTag = tag
        ? (tag.includes(':') ? tag.toLowerCase() : `type:${tag.toLowerCase()}`)
        : undefined;
      const allTags = [
        ...(mcpTag ? [mcpTag] : []),
        ...qualityTags,
      ];
      const params = {
        name: tag ? `${tag}: ${text.slice(0, 60)}` : text.slice(0, 80),
        episode_body: text,
        source: options.source || 'text',
        group_id: groupId,
        tags: allTags.length > 0 ? allTags : undefined,
      };
      const result = await mcpClient.rpcCall<unknown>('add_memory', params);

      return {
        status: 'ok',
        action: 'add',
        group: groupId,
        text,
        tag,
        result,
        mode: 'mcp',
      };
    },

    async expire(
      groupId: string,
      uuid: string
    ): Promise<IMemoryExpireResult> {
      await neo4jClient.connect();
      try {
        const cypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
          SET r.expired_at = datetime()
          RETURN count(r) AS affected
        `;
        const result = await neo4jClient.writeQuery<{ affected: number }>(
          cypher, { groupId, uuid }
        );
        const affected = result[0]?.affected ?? 0;

        return {
          status: 'ok',
          action: 'expire',
          group: groupId,
          uuid,
          found: affected > 0,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async cleanup(
      groupId: string,
      dryRun: boolean
    ): Promise<IMemoryCleanupResult> {
      await neo4jClient.connect();
      try {
        const now = new Date();
        let totalExpired = 0;

        const tiers: MemoryLifecycle[] = ['session', 'ephemeral'];

        for (const tier of tiers) {
          const ttl = LIFECYCLE_DEFAULTS[tier];
          if (ttl === null) continue;

          const cutoff = new Date(now.getTime() - ttl);
          const lifecycleTag = resolveLifecycleTag(tier);

          if (dryRun) {
            const countCypher = `
              MATCH (s:Entity)-[r]->(t:Entity)
              WHERE r.group_id = $groupId
                AND r.expired_at IS NULL
                AND $lifecycleTag IN r.tags
                AND r.created_at <= datetime($cutoff)
              RETURN count(r) AS count
            `;
            const countResult = await neo4jClient.query<{ count: number }>(
              countCypher,
              { groupId, lifecycleTag, cutoff: cutoff.toISOString() }
            );
            totalExpired += countResult[0]?.count ?? 0;
          } else {
            const expireCypher = `
              MATCH (s:Entity)-[r]->(t:Entity)
              WHERE r.group_id = $groupId
                AND r.expired_at IS NULL
                AND $lifecycleTag IN r.tags
                AND r.created_at <= datetime($cutoff)
              SET r.expired_at = datetime()
              RETURN count(r) AS expired
            `;
            const writeResult = await neo4jClient.writeQuery<{ expired: number }>(
              expireCypher,
              { groupId, lifecycleTag, cutoff: cutoff.toISOString() }
            );
            totalExpired += writeResult[0]?.expired ?? 0;
          }
        }

        return {
          status: 'ok',
          action: 'cleanup',
          group: groupId,
          expiredCount: totalExpired,
          dryRun,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async verify(
      groupId: string,
      uuid: string
    ): Promise<IMemoryVerifyResult> {
      await neo4jClient.connect();
      try {
        // Load fact to get current confidence
        const loadCypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
          RETURN r.tags AS tags
        `;
        const records = await neo4jClient.query<{ tags: string[] }>(
          loadCypher, { groupId, uuid }
        );
        if (records.length === 0) {
          throw new MemoryError(`Fact not found: ${uuid}`, { groupId, uuid });
        }

        const currentTags = records[0].tags ?? [];
        const previousConfidence = parseConfidenceTag(currentTags);

        // Remove old confidence tag, add verified
        const newTags = currentTags.filter(t => !t.startsWith('confidence:'));
        newTags.push(resolveConfidenceTag('verified'));

        // Update tags in place
        const updateCypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
          SET r.tags = $newTags
          RETURN count(r) AS affected
        `;
        const writeResult = await neo4jClient.writeQuery<{ affected: number }>(
          updateCypher, { groupId, uuid, newTags }
        );
        const affected = writeResult[0]?.affected ?? 0;
        if (affected === 0) {
          throw new MemoryError(
            `Fact expired or not found during verify: ${uuid}`,
            { groupId, uuid }
          );
        }

        return {
          status: 'ok',
          action: 'verify',
          group: groupId,
          uuid,
          previousConfidence,
          newConfidence: 'verified',
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async curate(
      groupId: string,
      groupIds: string[],
      options: ICurateOptions
    ): Promise<IMemoryCurateResult> {
      await neo4jClient.connect();
      try {
        const limit = options.limit ?? 50;
        const params: Record<string, unknown> = {
          groupIds,
          limit: Math.floor(limit) * 3, // Over-fetch for client-side filtering
        };

        const dateFilters: string[] = [];
        if (options.since) {
          const sinceDate = parseDate(options.since);
          if (sinceDate) {
            dateFilters.push('r.created_at >= datetime($since)');
            params.since = sinceDate.toISOString();
          }
        }

        const dateFilterClause = dateFilters.length > 0 ? `AND ${dateFilters.join(' AND ')}` : '';

        const cypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id IN $groupIds
            AND r.expired_at IS NULL
            ${dateFilterClause}
          RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                 r.group_id AS group_id, r.created_at AS created_at,
                 r.tags AS tags
          ORDER BY r.created_at DESC
          LIMIT $limit
        `;

        const records: Neo4jFactRecord[] = await neo4jClient.query(cypher, params);
        const now = Date.now();

        let curateFacts: ICurateFact[] = records.map(r => {
          const tags = r.tags ?? [];
          const confidence = parseConfidenceTag(tags);
          const source = parseSourceTag(tags);
          const lifecycle = parseLifecycleTag(tags);
          const createdDate = r.created_at ? new Date(r.created_at) : null;
          const createdMs =
            createdDate && !Number.isNaN(createdDate.getTime())
              ? createdDate.getTime()
              : now;
          const age = formatAge(now - createdMs);

          return {
            uuid: r.uuid,
            fact: r.fact,
            confidence,
            source,
            lifecycle,
            created_at: r.created_at,
            age,
            tags,
          };
        });

        // Filter by min confidence if provided
        if (options.minConfidence) {
          const minScore = CONFIDENCE_SCORES[options.minConfidence];
          curateFacts = curateFacts.filter(f => {
            if (!f.confidence) return true; // Include unscored facts for curation
            return CONFIDENCE_SCORES[f.confidence] >= minScore;
          });
        }

        // Sort by confidence ascending (lowest first for review)
        curateFacts.sort((a, b) => {
          const scoreA = a.confidence ? CONFIDENCE_SCORES[a.confidence] : 0;
          const scoreB = b.confidence ? CONFIDENCE_SCORES[b.confidence] : 0;
          return scoreA - scoreB;
        });

        // Trim to requested limit
        curateFacts = curateFacts.slice(0, limit);

        return {
          status: 'ok',
          action: 'curate',
          group: groupId,
          facts: curateFacts,
          totalReviewed: curateFacts.length,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async conflicts(
      groupIds: string[],
      topic?: string
    ): Promise<IMemoryConflictsResult> {
      await neo4jClient.connect();
      try {
        const params: Record<string, unknown> = {
          groupIds,
          limit: 200,
        };

        const cypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id IN $groupIds
            AND r.expired_at IS NULL
          RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                 r.group_id AS group_id, r.created_at AS created_at,
                 r.tags AS tags
          ORDER BY r.created_at DESC
          LIMIT $limit
        `;

        const records: Neo4jFactRecord[] = await neo4jClient.query(cypher, params);

        // Utility tag prefixes to exclude from topic grouping
        const utilityPrefixes = ['lifecycle:', 'confidence:', 'source:', 'type:'];

        // Group facts by non-utility tags
        const tagGroups = new Map<string, IFact[]>();

        for (const r of records) {
          const tags = r.tags ?? [];
          const topicTags = tags.filter(t => !utilityPrefixes.some(p => t.startsWith(p)));

          for (const tag of topicTags) {
            if (!tagGroups.has(tag)) {
              tagGroups.set(tag, []);
            }
            tagGroups.get(tag)!.push({
              uuid: r.uuid,
              name: r.name,
              fact: r.fact,
              group_id: r.group_id,
              created_at: r.created_at,
              tags,
            });
          }
        }

        // Find groups with differing content (potential conflicts)
        const conflicts: Array<{ topic: string; facts: IFact[]; detectedAt: string }> = [];
        const detectedAt = new Date().toISOString();

        for (const [tag, facts] of tagGroups.entries()) {
          if (facts.length < 2) continue;

          // Check if facts have differing content
          const uniqueContents = new Set(facts.map(f => f.fact));
          if (uniqueContents.size > 1) {
            conflicts.push({ topic: tag, facts, detectedAt });
          }
        }

        // Filter by topic if provided
        let filtered = conflicts;
        if (topic) {
          const topicLower = topic.toLowerCase();
          filtered = conflicts.filter(c => c.topic.toLowerCase().includes(topicLower));
        }

        return {
          status: 'ok',
          action: 'conflicts',
          group: groupIds[0] || '',
          conflicts: filtered,
          totalGroups: filtered.length,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },
  };
}
