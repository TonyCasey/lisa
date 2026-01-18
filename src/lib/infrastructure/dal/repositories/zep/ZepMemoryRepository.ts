/**
 * Zep Cloud Memory Repository
 *
 * Memory repository using Zep Cloud REST API.
 * Cloud-based alternative that doesn't require Docker.
 */

import type { IMemoryItem } from '../../../../domain/interfaces/types/IMemoryResult';
import type {
  IMemoryRepository,
  IMemorySaveOptions,
  IQueryOptions,
  IMemoryQueryResult,
} from '../../../../domain/interfaces/dal';
import { applyQueryDefaults } from '../../../../domain/interfaces/dal';
import { ZepConnectionManager } from '../../connections/ZepConnectionManager';

/**
 * Zep graph search response.
 */
interface ZepSearchResponse {
  edges?: ZepEdge[];
}

/**
 * Zep edge (fact) structure.
 */
interface ZepEdge {
  uuid?: string;
  name?: string;
  fact?: string;
  created_at?: string;
}

/**
 * Zep message add response.
 */
interface ZepAddResponse {
  message_uuids?: string[];
}

/**
 * Zep Cloud Memory Repository implementation.
 * Uses Zep's native graph API for memory storage.
 */
export class ZepMemoryRepository implements IMemoryRepository {
  constructor(private readonly connection: ZepConnectionManager) {}

  /**
   * Find facts by group IDs using Zep graph search.
   */
  async findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult> {
    const opts = applyQueryDefaults(options);
    const { query, limit } = opts;

    const allFacts: IMemoryItem[] = [];

    // Search across all group IDs
    for (const groupId of groupIds) {
      const userId = `lisa-${groupId}`;
      const perGroupLimit = Math.ceil(limit! / groupIds.length);

      try {
        const response = await this.connection.fetch<ZepSearchResponse>('/graph/search', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            query: query || '*',
            limit: perGroupLimit,
            search_scope: 'facts',
          }),
        });

        const facts = (response.edges || []).map(this.toMemoryItem);
        allFacts.push(...facts);
      } catch {
        // Group might not exist yet, continue to next
      }
    }

    // Sort by created_at descending
    allFacts.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

    // Apply limit
    const items = allFacts.slice(0, limit);

    return {
      items,
      source: 'zep',
      hasMore: allFacts.length > limit!,
    };
  }

  /**
   * Semantic search using Zep's graph search.
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
   * Note: Zep may not support tag filtering directly.
   */
  async findByTags(
    groupIds: readonly string[],
    tags: readonly string[],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<IMemoryQueryResult> {
    // Zep doesn't have direct tag filtering, so we filter client-side
    const result = await this.findByGroupIds(groupIds, options);
    
    if (tags.length === 0) {
      return result;
    }

    // Filter by tags (if they exist in the response)
    const filtered = result.items.filter((item) => {
      if (!item.tags) return false;
      return tags.some((tag) => item.tags!.includes(tag));
    });

    return {
      items: filtered,
      source: 'zep',
      hasMore: false,
    };
  }

  /**
   * Save a fact via Zep threads API.
   */
  async save(
    groupId: string,
    content: string,
    options?: IMemorySaveOptions
  ): Promise<IMemoryItem> {
    const userId = `lisa-${groupId}`;
    const threadId = `lisa-memory-${groupId}`;

    // Ensure user and thread exist
    await this.connection.ensureUser(userId);
    await this.connection.getOrCreateThread(threadId, userId);

    // Include tags in the message content
    const textWithMeta = options?.tags?.length
      ? `[${options.tags.join(', ')}] ${content}`
      : content;

    // Add message to thread (Zep extracts facts automatically)
    const response = await this.connection.fetch<ZepAddResponse>(
      `/threads/${encodeURIComponent(threadId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              role_type: 'user',
              content: `[${options?.source || 'lisa-dal'}] ${textWithMeta}`,
            },
          ],
        }),
      }
    );

    return {
      uuid: response.message_uuids?.[0],
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

    for (const content of facts) {
      const item = await this.save(groupId, content, options);
      results.push(item);
    }

    return results;
  }

  /**
   * Zep supports semantic search.
   */
  supportsSemanticSearch(): boolean {
    return true;
  }

  /**
   * Zep supports date ordering (via client-side sort).
   */
  supportsDateOrdering(): boolean {
    return true;
  }

  /**
   * Zep supports write operations.
   */
  supportsWrite(): boolean {
    return true;
  }

  /**
   * Convert Zep edge to IMemoryItem.
   */
  private toMemoryItem(edge: ZepEdge): IMemoryItem {
    return {
      uuid: edge.uuid,
      name: edge.name,
      fact: edge.fact,
      created_at: edge.created_at,
    };
  }
}
