import type { IMemoryResult, IMemoryItem } from './types';
import type { IMemorySaveOptions } from './dal/IMemoryRepository';

/**
 * Options for date-filtered memory queries.
 */
export interface IMemoryDateOptions {
  /** Filter facts created after this date */
  since?: Date;
  /** Filter facts created before this date */
  until?: Date;
}

/**
 * Read operations for memory.
 * Separated for Interface Segregation Principle.
 */
export interface IMemoryReader {
  /**
   * Load memory for a group, querying hierarchically.
   * @param groupIds - Hierarchical group IDs to query
   * @param aliases - Project aliases for tagging
   * @param branch - Current git branch (for tagging)
   * @param timeoutMs - Timeout in milliseconds
   */
  loadMemory(
    groupIds: readonly string[],
    aliases: readonly string[],
    branch: string | null,
    timeoutMs?: number
  ): Promise<IMemoryResult>;

  /**
   * Load facts with date ordering (newest first).
   * Uses DAL router with Neo4j when available for optimal performance.
   * @param groupIds - Group IDs to query
   * @param limit - Maximum number of facts to return
   * @param options - Optional date filtering options
   */
  loadFactsDateOrdered(
    groupIds: readonly string[],
    limit?: number,
    options?: IMemoryDateOptions
  ): Promise<IMemoryItem[]>;

  /**
   * Semantic search for facts.
   * Uses DAL router with MCP when available.
   * @param groupIds - Group IDs to search
   * @param query - Search query
   * @param limit - Maximum number of results
   */
  searchFacts(
    groupIds: readonly string[],
    query: string,
    limit?: number
  ): Promise<IMemoryItem[]>;
}

/**
 * Write operations for memory.
 * Separated for Interface Segregation Principle.
 */
export interface IMemoryWriter {
  /**
   * Save facts to memory.
   * @param groupId - Group ID to save to
   * @param facts - Facts to save
   */
  saveMemory(groupId: string, facts: readonly string[]): Promise<void>;

  /**
   * Add a single fact to memory.
   * @param groupId - Group ID to save to
   * @param fact - Fact to add
   * @param tags - Optional tags for the fact
   */
  addFact(groupId: string, fact: string, tags?: readonly string[]): Promise<void>;

  /**
   * Add a fact with lifecycle metadata.
   * Enriches tags with lifecycle:<tier> tag and delegates to addFact.
   * @param groupId - Group ID to save to
   * @param fact - Fact to add
   * @param options - Save options including lifecycle and TTL
   */
  addFactWithLifecycle(
    groupId: string,
    fact: string,
    options: IMemorySaveOptions
  ): Promise<void>;

  /**
   * Expire a single fact by UUID.
   * Routes to Neo4j repository for direct Cypher expiration.
   * @param groupId - Group ID the fact belongs to
   * @param uuid - UUID of the fact to expire
   */
  expireFact(groupId: string, uuid: string): Promise<void>;

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   * Expires session facts older than 24h and ephemeral facts older than 1h.
   * @param groupId - Group ID to clean up
   * @returns Number of facts expired
   */
  cleanupExpired(groupId: string): Promise<number>;
}

/**
 * Full memory service interface.
 * Combines read and write operations.
 */
export interface IMemoryService extends IMemoryReader, IMemoryWriter {}
