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
  IMemoryLinkResult,
  IMemoryLinksResult,
  IMemoryRelationshipItem,
} from './interfaces';
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

    async linkFacts(
      groupId: string,
      sourceUuid: string,
      targetUuid: string,
      relationType: string,
      metadata?: string
    ): Promise<IMemoryLinkResult> {
      await neo4jClient.connect();
      try {
        // Preflight: verify both facts exist
        const checkCypher = `
          OPTIONAL MATCH (s1:Entity)-[sr]->(t1:Entity)
          WHERE sr.uuid = $sourceUuid AND sr.group_id IN $groupIds
          WITH count(sr) > 0 AS sourceExists
          OPTIONAL MATCH (s2:Entity)-[tr]->(t2:Entity)
          WHERE tr.uuid = $targetUuid AND tr.group_id IN $groupIds
          RETURN sourceExists, count(tr) > 0 AS targetExists
        `;
        const checkResults = await neo4jClient.query<{ sourceExists: boolean; targetExists: boolean }>(
          checkCypher,
          { sourceUuid, targetUuid, groupIds: [groupId] }
        );
        const check = checkResults[0];
        if (!check?.sourceExists) {
          throw new Error(`Source fact not found: ${sourceUuid}`);
        }
        if (!check?.targetExists) {
          throw new Error(`Target fact not found: ${targetUuid}`);
        }

        const cypher = `
          MATCH (s1:Entity)-[sr]->(t1:Entity)
          WHERE sr.uuid = $sourceUuid AND sr.group_id IN $groupIds
          WITH t1, sr
          LIMIT 1
          MATCH (s2:Entity)-[tr]->(t2:Entity)
          WHERE tr.uuid = $targetUuid AND tr.group_id IN $groupIds
          WITH t1, t2, sr, tr
          LIMIT 1
          MERGE (t1)-[rel:MEMORY_RELATION {type: $relationType, source_uuid: $sourceUuid, target_uuid: $targetUuid, group_id: $groupId}]->(t2)
          SET rel.created_at = datetime(),
              rel.metadata = $metadata
        `;

        await neo4jClient.write(cypher, {
          sourceUuid,
          targetUuid,
          relationType,
          metadata: metadata ?? null,
          groupId,
          groupIds: [groupId],
        });

        return {
          status: 'ok',
          action: 'link',
          group: groupId,
          sourceUuid,
          targetUuid,
          relationType,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },

    async getRelatedFacts(
      groupId: string,
      uuid: string,
      relationType?: string
    ): Promise<IMemoryLinksResult> {
      await neo4jClient.connect();
      try {
        const typeFilter = relationType ? 'AND rel.type = $relationType' : '';

        // Query outgoing relationships
        const outgoingCypher = `
          MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)
          WHERE rel.source_uuid = $uuid
            AND rel.group_id = $groupId
            ${typeFilter}
          RETURN rel.source_uuid AS sourceUuid,
                 rel.target_uuid AS targetUuid,
                 rel.type AS relationType,
                 rel.metadata AS metadata,
                 rel.created_at AS created_at
        `;

        // Query incoming relationships
        const incomingCypher = `
          MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)
          WHERE rel.target_uuid = $uuid
            AND rel.group_id = $groupId
            ${typeFilter}
          RETURN rel.source_uuid AS sourceUuid,
                 rel.target_uuid AS targetUuid,
                 rel.type AS relationType,
                 rel.metadata AS metadata,
                 rel.created_at AS created_at
        `;

        const params = {
          uuid,
          groupId,
          relationType: relationType ?? null,
        };

        const [outgoing, incoming] = await Promise.all([
          neo4jClient.query<IMemoryRelationshipItem>(outgoingCypher, params),
          neo4jClient.query<IMemoryRelationshipItem>(incomingCypher, params),
        ]);

        const relationships: IMemoryRelationshipItem[] = [
          ...outgoing.map((r) => ({
            sourceUuid: r.sourceUuid,
            targetUuid: r.targetUuid,
            relationType: r.relationType,
            metadata: r.metadata ?? undefined,
            created_at: r.created_at ?? undefined,
          })),
          ...incoming.map((r) => ({
            sourceUuid: r.sourceUuid,
            targetUuid: r.targetUuid,
            relationType: r.relationType,
            metadata: r.metadata ?? undefined,
            created_at: r.created_at ?? undefined,
          })),
        ];

        return {
          status: 'ok',
          action: 'links',
          group: groupId,
          uuid,
          relationships,
          mode: 'neo4j',
        };
      } finally {
        await neo4jClient.disconnect();
      }
    },
  };
}
