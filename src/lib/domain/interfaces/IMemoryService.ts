import type { IMemoryResult, IMemoryItem } from './types';

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
}

/**
 * Full memory service interface.
 * Combines read and write operations.
 */
export interface IMemoryService extends IMemoryReader, IMemoryWriter {}
