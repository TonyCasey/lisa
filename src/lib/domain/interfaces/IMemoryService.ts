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
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */
export interface IMemoryReader {
  /**
   * Load memory from the repository.
   * @param timeoutMs - Timeout in milliseconds
   */
  loadMemory(timeoutMs?: number): Promise<IMemoryResult>;

  /**
   * Load facts with date ordering (newest first).
   * @param limit - Maximum number of facts to return
   * @param options - Optional date filtering options
   */
  loadFactsDateOrdered(
    limit?: number,
    options?: IMemoryDateOptions
  ): Promise<IMemoryItem[]>;

  /**
   * Semantic search for facts.
   * @param query - Search query
   * @param limit - Maximum number of results
   */
  searchFacts(query: string, limit?: number): Promise<IMemoryItem[]>;
}

/**
 * Write operations for memory.
 * Separated for Interface Segregation Principle.
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping.
 */
export interface IMemoryWriter {
  /**
   * Save facts to memory.
   * @param facts - Facts to save
   */
  saveMemory(facts: readonly string[]): Promise<void>;

  /**
   * Add a single fact to memory.
   * @param fact - Fact to add
   * @param tags - Optional tags for the fact
   */
  addFact(fact: string, tags?: readonly string[]): Promise<void>;

  /**
   * Add a fact with lifecycle metadata.
   * Enriches tags with lifecycle:<tier> tag and delegates to addFact.
   * @param fact - Fact to add
   * @param options - Save options including lifecycle and TTL
   */
  addFactWithLifecycle(fact: string, options: IMemorySaveOptions): Promise<void>;

  /**
   * Expire a single fact by UUID.
   * @param uuid - UUID of the fact to expire
   */
  expireFact(uuid: string): Promise<void>;

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   * Expires session facts older than 24h and ephemeral facts older than 1h.
   * @returns Number of facts expired
   */
  cleanupExpired(): Promise<number>;
}

/**
 * Full memory service interface.
 * Combines read and write operations.
 */
export interface IMemoryService extends IMemoryReader, IMemoryWriter {}
