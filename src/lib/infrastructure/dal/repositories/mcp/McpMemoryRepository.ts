/**
 * MCP Memory Repository
 *
 * Memory repository using Graphiti MCP server.
 * Supports semantic search and write operations.
 */

import type { IMemoryItem } from '../../../../domain/interfaces/types/IMemoryResult';
import type {
  IMemoryRepository,
  IMemorySaveOptions,
  IQueryOptions,
  IMemoryQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { McpConnectionManager } from '../../connections/McpConnectionManager';

/**
 * MCP search_memory_facts response.
 */
interface McpFactsResponse {
  facts?: McpFact[];
  result?: {
    facts?: McpFact[];
  };
}

/**
 * MCP fact structure.
 */
interface McpFact {
  uuid?: string;
  name?: string;
  fact?: string;
  created_at?: string;
  group_id?: string;
  tags?: string[];
}

/**
 * MCP Memory Repository implementation.
 * Full read/write support via Graphiti MCP.
 */
export class McpMemoryRepository implements IMemoryRepository {
  constructor(private readonly connection: McpConnectionManager) {}

  /**
   * Find facts by group IDs using MCP search.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult> {
    const opts = applyQueryDefaults(options);
    const { query, limit, tags } = opts;

    const params: Record<string, unknown> = {
      query: query || '*',
      max_facts: limit,
      group_ids: [...groupIds],
    };

    if (tags && tags.length > 0) {
      params.tags = [...tags];
    }

    const response = await this.connection.call<McpFactsResponse>(
      'search_memory_facts',
      params
    );

    const facts = response?.facts || response?.result?.facts || [];
    const items = facts.map(this.toMemoryItem);

    // MCP returns results sorted by relevance, not date
    // Client-side sort by date if no query (listing mode)
    if (!query || query === '*') {
      items.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA; // Descending
      });
    }

    return {
      items,
      source: 'mcp',
      hasMore: items.length === limit,
    };
  }

  /**
   * Semantic search using MCP's embedding-based search.
   */
  async search(
    groupIds: readonly string[],
    query: string,
    options?: Omit<IQueryOptions, 'query'>
  ): Promise<IMemoryQueryResult> {
    return this.findByGroupIds(groupIds, { ...options, query });
  }

  /**
   * Find facts by tags.
   */
  async findByTags(
    groupIds: readonly string[],
    tags: readonly string[],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<IMemoryQueryResult> {
    return this.findByGroupIds(groupIds, { ...options, tags });
  }

  /**
   * Save a new fact via MCP add_memory.
   */
  async save(
    groupId: string,
    content: string,
    options?: IMemorySaveOptions
  ): Promise<IMemoryItem> {
    const params: Record<string, unknown> = {
      name: content.slice(0, 80),
      episode_body: content,
      group_id: groupId,
      source: options?.source || 'lisa-dal',
    };

    if (options?.tags && options.tags.length > 0) {
      params.tags = [...options.tags];
    }

    await this.connection.call('add_memory', params);

    return {
      name: content.slice(0, 80),
      fact: content,
      tags: options?.tags,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Save multiple facts in batch.
   */
  async saveBatch(
    groupId: string,
    facts: readonly string[],
    options?: IMemorySaveOptions
  ): Promise<readonly IMemoryItem[]> {
    const results: IMemoryItem[] = [];

    // MCP doesn't have batch add, so we do them sequentially
    // Could be parallelized with Promise.all if needed
    for (const content of facts) {
      const item = await this.save(groupId, content, options);
      results.push(item);
    }

    return results;
  }

  /**
   * MCP supports semantic search via embeddings.
   */
  supportsSemanticSearch(): boolean {
    return true;
  }

  /**
   * MCP returns date-ordered results (via client-side sort).
   */
  supportsDateOrdering(): boolean {
    return true;
  }

  /**
   * MCP supports write operations.
   */
  supportsWrite(): boolean {
    return true;
  }

  /**
   * Convert MCP fact to IMemoryItem.
   */
  private toMemoryItem(fact: McpFact): IMemoryItem {
    return {
      uuid: fact.uuid,
      name: fact.name,
      fact: fact.fact,
      tags: fact.tags,
      created_at: fact.created_at,
    };
  }
}
