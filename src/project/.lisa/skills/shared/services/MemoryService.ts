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
} from './interfaces';

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
      limit: number
    ): Promise<IMemoryLoadResult> {
      // Always use Neo4j for load (better date ordering)
      const groupList = groupIds.map((g) => `"${g}"`).join(', ');

      await neo4jClient.connect();
      try {
        let cypher: string;

        if (query && query !== '*') {
          // Search mode: filter by query in fact text
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN [${groupList}]
              AND r.expired_at IS NULL
              AND (r.fact CONTAINS $query OR r.name CONTAINS $query)
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at
            ORDER BY r.created_at DESC
            LIMIT ${limit}
          `;
        } else {
          // List mode: return recent facts
          cypher = `
            MATCH (s:Entity)-[r]->(t:Entity)
            WHERE r.group_id IN [${groupList}]
              AND r.expired_at IS NULL
            RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact,
                   r.group_id AS group_id, r.created_at AS created_at,
                   r.valid_at AS valid_at, r.expired_at AS expired_at
            ORDER BY r.created_at DESC
            LIMIT ${limit}
          `;
        }

        const records: Neo4jFactRecord[] = await neo4jClient.query(
          cypher,
          query && query !== '*' ? { query } : {}
        );

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
      const params = {
        name: tag ? `${tag}: ${text.slice(0, 60)}` : text.slice(0, 80),
        episode_body: text,
        source: options.source || 'text',
        group_id: groupId,
        tags: tag ? [`type:${tag.toLowerCase()}`] : undefined,
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
  };
}
