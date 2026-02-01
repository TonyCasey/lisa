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
  IMemoryConflictsResult,
  IMemoryDedupeResult,
  IMemoryCurateResult,
  IMemoryConsolidateResult,
  IConflictGroup,
} from './interfaces';
import { detectDuplicatesFromFacts } from '../../../domain/utils/deduplication';
import { isValidCurationMark, resolveCurationTag } from '../../../domain/interfaces/ICurationService';
import { resolveConfidenceTag } from '../../../domain/interfaces/types/IMemoryQuality';
import { CONSOLIDATION_ACTION_VALUES } from '../../../domain/interfaces/IConsolidationService';
import type { ConsolidationAction } from '../../../domain/interfaces/IConsolidationService';
import { LIFECYCLE_DEFAULTS, resolveLifecycleTag } from '../../../domain/interfaces/types/IMemoryLifecycle';
import type { MemoryLifecycle } from '../../../domain/interfaces/types/IMemoryLifecycle';

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
 *
 * @param text - Memory text (may contain PREFIX: pattern)
 * @param options - Memory options with type/tag
 * @returns Resolved tag or undefined
 */
function resolveTag(text: string, options: IMemoryAddOptions): string | undefined {
  // Explicit tag takes precedence
  if (options.tag) return options.tag;

  // Check type mapping
  if (options.type && TYPE_TAG_MAP[options.type.toLowerCase()]) {
    return TYPE_TAG_MAP[options.type.toLowerCase()];
  }

  // Check for PREFIX: pattern in text
  const prefixMatch = text.match(/^([A-Z_]+):\s*/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return undefined;
}

/**
 * Creates a memory service instance.
 *
 * @param deps - Service dependencies (clients)
 * @returns Memory service implementation
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
      // Always use Neo4j for load (better date ordering)
      // Use parameterized query for groupIds to prevent Cypher injection
      // Neo4j requires integer for LIMIT - ensure it's not a float
      const params: Record<string, unknown> = {
        groupIds,
        limit: Math.floor(limit),
      };

      // Build date filter clauses
      const dateFilters: string[] = [];
      
      if (options?.since) {
        dateFilters.push('r.created_at >= datetime($since)');
        params.since = options.since.toISOString();
      }
      if (options?.until) {
        dateFilters.push('r.created_at <= datetime($until)');
        params.until = options.until.toISOString();
      }
      
      const dateFilterClause = dateFilters.length > 0 ? `AND ${dateFilters.join(' AND ')}` : '';

      await neo4jClient.connect();
      try {
        let cypher: string;

        if (query && query !== '*') {
          // Search mode: filter by query in fact text
          params.query = query;
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN $groupIds
              AND r.expired_at IS NULL
              AND (r.fact CONTAINS $query OR r.name CONTAINS $query)
              ${dateFilterClause}
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at
            ORDER BY r.created_at DESC
            LIMIT $limit
          `;
        } else {
          // List mode: return recent facts
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN $groupIds
              AND r.expired_at IS NULL
              ${dateFilterClause}
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at
            ORDER BY r.created_at DESC
            LIMIT $limit
          `;
        }

        const records: Neo4jFactRecord[] = await neo4jClient.query(cypher, params);

        // Transform to standard fact format
        const facts: IFact[] = records.map((r: Neo4jFactRecord) => ({
          uuid: r.uuid,
          name: r.name,
          fact: r.fact,
          group_id: r.group_id,
          created_at: r.created_at,
          valid_at: r.valid_at,
          expired_at: r.expired_at,
        }));

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

      // Use Zep if available
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

      // Use MCP
      await mcpClient.initialize();
      // Tags already containing ':' are namespaced (e.g. lifecycle:session, code:decision)
      // and should be stored as-is. Simple tags (DECISION, PATTERN) get 'type:' prefix.
      const mcpTag = tag
        ? (tag.includes(':') ? tag.toLowerCase() : `type:${tag.toLowerCase()}`)
        : undefined;
      const params = {
        name: tag ? `${tag}: ${text.slice(0, 60)}` : text.slice(0, 80),
        episode_body: text,
        source: options.source || 'text',
        group_id: groupId,
        tags: mcpTag ? [mcpTag] : undefined,
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
        // Atomic SET + RETURN to know if a record was actually expired
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
            // Count only (READ session)
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
            // Atomic SET + RETURN count (WRITE session, no TOCTOU race)
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

    async conflicts(
      groupIds: string[],
      topic?: string
    ): Promise<IMemoryConflictsResult> {
      await neo4jClient.connect();
      try {
        const params: Record<string, unknown> = { groupIds };

        const whereClauses: string[] = [
          `r.group_id IN $groupIds`,
          `r.fact IS NOT NULL`,
          `r.expired_at IS NULL`,
          `ANY(tag IN r.tags WHERE tag STARTS WITH 'type:')`,
        ];

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
          LIMIT 20
        `;

        const records = await neo4jClient.query<{
          topicTag: string;
          facts: Array<{ uuid: string; name: string; fact: string; group_id: string; created_at: string }>;
        }>(cypher, params);

        const conflictGroups: IConflictGroup[] = records.map((record) => ({
          topic: record.topicTag,
          facts: record.facts.map((f) => ({
            uuid: f.uuid,
            name: f.name,
            fact: f.fact,
            group_id: f.group_id,
            created_at: f.created_at,
          })),
          detectedAt: new Date().toISOString(),
        }));

        return {
          status: 'ok',
          action: 'conflicts',
          group: groupIds[0] || '',
          groups: groupIds,
          topic: topic || '',
          conflictGroups,
          totalConflicts: conflictGroups.length,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async dedupe(
      groupId: string,
      options?: { minSimilarity?: number; limit?: number; since?: Date }
    ): Promise<IMemoryDedupeResult> {
      const minSimilarity = options?.minSimilarity ?? 0.6;
      const limit = options?.limit ?? 10;

      await neo4jClient.connect();
      try {
        // Load all non-expired facts (up to 500)
        const params: Record<string, unknown> = {
          groupIds: [groupId],
          limit: 500,
        };

        const dateFilters: string[] = [];
        if (options?.since) {
          dateFilters.push('r.created_at >= datetime($since)');
          params.since = options.since.toISOString();
        }

        const dateFilterClause = dateFilters.length > 0 ? `AND ${dateFilters.join(' AND ')}` : '';

        const factsCypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id IN $groupIds
            AND r.expired_at IS NULL
            AND r.fact IS NOT NULL
            ${dateFilterClause}
          RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                 r.group_id AS group_id, r.created_at AS created_at
          ORDER BY r.created_at DESC
          LIMIT $limit
        `;

        const factRecords: Neo4jFactRecord[] = await neo4jClient.query(factsCypher, params);

        // Convert to IMemoryItem-compatible shape for the algorithm
        const facts = factRecords.map((r) => ({
          uuid: r.uuid,
          name: r.name,
          fact: r.fact,
          created_at: r.created_at,
        }));

        // Load conflict groups for tag overlap pass
        const conflictParams: Record<string, unknown> = { groupIds: [groupId] };
        const conflictDateFilters: string[] = [];
        if (options?.since) {
          conflictDateFilters.push('r.created_at >= datetime($since)');
          conflictParams.since = options.since.toISOString();
        }
        const conflictDateFilterClause =
          conflictDateFilters.length > 0 ? `AND ${conflictDateFilters.join(' AND ')}` : '';
        const conflictCypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id IN $groupIds
            AND r.fact IS NOT NULL
            AND r.expired_at IS NULL
            ${conflictDateFilterClause}
            AND ANY(tag IN r.tags WHERE tag STARTS WITH 'type:')
          WITH [tag IN r.tags WHERE tag STARTS WITH 'type:' | tag][0] AS topicTag,
               r.uuid AS uuid, r.name AS name, r.fact AS fact,
               r.group_id AS group_id, r.created_at AS created_at
          WITH topicTag, COLLECT({ uuid: uuid, name: name, fact: fact, group_id: group_id, created_at: created_at }) AS facts
          WHERE SIZE(facts) > 1
          RETURN topicTag, facts
          LIMIT 20
        `;

        const conflictRecords = await neo4jClient.query<{
          topicTag: string;
          facts: Array<{ uuid: string; name: string; fact: string; group_id: string; created_at: string }>;
        }>(conflictCypher, conflictParams);

        const conflictGroups = conflictRecords.map((record) => ({
          topic: record.topicTag,
          facts: record.facts.map((f) => ({
            uuid: f.uuid,
            name: f.name,
            fact: f.fact,
            created_at: f.created_at,
          })),
          detectedAt: new Date().toISOString(),
        }));

        // Run the three-pass detection algorithm
        const duplicateGroups = detectDuplicatesFromFacts(facts, conflictGroups, {
          minSimilarity,
          limit,
        });

        // Map IDuplicateGroup to skill-level format
        const skillGroups = duplicateGroups.map((g) => ({
          reason: g.reason,
          facts: g.facts.map((f) => ({
            uuid: f.uuid ?? '',
            name: f.name ?? '',
            fact: f.fact ?? '',
            group_id: groupId,
            created_at: f.created_at ?? '',
          })),
          similarity: g.similarity,
        }));

        const totalDuplicates = skillGroups.reduce((sum, group) => sum + group.facts.length, 0);
        return {
          status: 'ok',
          action: 'dedupe',
          group: groupId,
          totalFactsScanned: facts.length,
          duplicateGroups: skillGroups,
          totalDuplicates,
          minSimilarity,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async curate(
      groupId: string,
      uuid: string,
      mark: string
    ): Promise<IMemoryCurateResult> {
      if (!isValidCurationMark(mark)) {
        throw new Error(`Invalid curation mark: "${mark}". Valid marks: authoritative, draft, deprecated, needs-review`);
      }

      await neo4jClient.connect();
      try {
        const curationTag = resolveCurationTag(mark);

        // Add the curation tag to the fact's tags array
        const addTagCypher = `
          MATCH (s:Entity)-[r]->(t:Entity)
          WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
          SET r.tags = CASE
            WHEN r.tags IS NULL THEN [$curationTag]
            ELSE [tag IN r.tags WHERE NOT tag STARTS WITH 'curated:'] + [$curationTag]
          END
          RETURN count(r) AS affected
        `;
        const result = await neo4jClient.writeQuery<{ affected: number }>(
          addTagCypher, { groupId, uuid, curationTag }
        );
        const affected = result[0]?.affected ?? 0;

        if (affected === 0) {
          throw new Error(`Fact not found: uuid="${uuid}" in group="${groupId}"`);
        }

        // Side effects
        if (mark === 'deprecated') {
          // Expire the fact
          const expireCypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id = $groupId AND r.uuid = $uuid
            SET r.expired_at = datetime()
            RETURN count(r) AS affected
          `;
          await neo4jClient.writeQuery(expireCypher, { groupId, uuid });
        }

        if (mark === 'authoritative') {
          // Promote confidence to verified
          const confidenceTag = resolveConfidenceTag('verified');
          const promoteCypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id = $groupId AND r.uuid = $uuid
            SET r.tags = CASE
              WHEN r.tags IS NULL THEN [$confidenceTag]
              ELSE [tag IN r.tags WHERE NOT tag STARTS WITH 'confidence:'] + [$confidenceTag]
            END
            RETURN count(r) AS affected
          `;
          await neo4jClient.writeQuery(promoteCypher, { groupId, uuid, confidenceTag });
        }

        return {
          status: 'ok',
          action: 'curate',
          group: groupId,
          uuid,
          mark,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async consolidate(
      groupId: string,
      factUuids: string[],
      action: string,
      options?: { retainUuid?: string; mergedText?: string }
    ): Promise<IMemoryConsolidateResult> {
      if (!CONSOLIDATION_ACTION_VALUES.includes(action as ConsolidationAction)) {
        throw new Error(`Invalid consolidation action: "${action}". Valid actions: merge, archive-duplicates, keep-all`);
      }
      if (factUuids.length < 2) {
        throw new Error('Consolidation requires at least 2 fact UUIDs');
      }
      if (options?.retainUuid && !factUuids.includes(options.retainUuid)) {
        throw new Error(`retainUuid "${options.retainUuid}" is not in the provided fact UUIDs`);
      }

      if (action === 'keep-all') {
        return {
          status: 'ok',
          action: 'consolidate',
          group: groupId,
          consolidationAction: 'keep-all',
          retainedUuid: factUuids[0],
          archivedUuids: [],
          relationshipsCreated: 0,
          mode: 'neo4j',
        };
      }

      await neo4jClient.connect();
      try {
        if (action === 'merge') {
          const mergedText = options?.mergedText;
          if (!mergedText) {
            throw new Error('merge action requires --text with merged text');
          }

          // Add the new merged fact via MCP
          await mcpClient.initialize();
          const mcpParams = {
            name: mergedText.slice(0, 80),
            episode_body: mergedText,
            source: 'consolidation',
            group_id: groupId,
            tags: ['source:consolidation'],
          };
          await mcpClient.rpcCall<unknown>('add_memory', mcpParams);

          // Expire all original facts
          const archivedUuids: string[] = [];
          for (const uuid of factUuids) {
            const expireCypher = `
              MATCH (s:Entity)-[r]->(t:Entity)
              WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
              SET r.expired_at = datetime()
              RETURN count(r) AS affected
            `;
            await neo4jClient.writeQuery(expireCypher, { groupId, uuid });
            archivedUuids.push(uuid);
          }

          return {
            status: 'ok',
            action: 'consolidate',
            group: groupId,
            consolidationAction: 'merge',
            retainedUuid: 'new-merged-fact',
            archivedUuids,
            relationshipsCreated: 0,
            mode: 'neo4j',
          };
        }

        // archive-duplicates
        let retainUuid = options?.retainUuid;

        if (!retainUuid) {
          // Find the newest fact in the list
          const placeholders = factUuids.map((_, i) => `$uuid_${i}`);
          const uuidParams: Record<string, unknown> = { groupId };
          factUuids.forEach((uuid, i) => { uuidParams[`uuid_${i}`] = uuid; });

          const findNewestCypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id = $groupId AND r.uuid IN [${placeholders.join(',')}] AND r.expired_at IS NULL
            RETURN r.uuid AS uuid
            ORDER BY r.created_at DESC
            LIMIT 1
          `;
          const newestResult = await neo4jClient.query<{ uuid: string }>(findNewestCypher, uuidParams);
          retainUuid = newestResult[0]?.uuid ?? factUuids[0];
        }

        // Expire all except retained
        const archivedUuids: string[] = [];
        for (const uuid of factUuids) {
          if (uuid !== retainUuid) {
            const expireCypher = `
              MATCH (s:Entity)-[r]->(t:Entity)
              WHERE r.group_id = $groupId AND r.uuid = $uuid AND r.expired_at IS NULL
              SET r.expired_at = datetime()
              RETURN count(r) AS affected
            `;
            await neo4jClient.writeQuery(expireCypher, { groupId, uuid });
            archivedUuids.push(uuid);
          }
        }

        return {
          status: 'ok',
          action: 'consolidate',
          group: groupId,
          consolidationAction: 'archive-duplicates',
          retainedUuid: retainUuid,
          archivedUuids,
          relationshipsCreated: 0,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },
  };
}
