/**
 * Memory Repository Interface
 *
 * Contract for memory data access operations.
 * Implementations may use MCP, Neo4j, or Zep Cloud as backend.
 */

import { IMemoryItem } from '../types/IMemoryResult';
import { IQueryOptions, IMemoryQueryResult } from './types';

/**
 * Options for saving memory.
 */
export interface IMemorySaveOptions {
  /** Tags to apply to the memory */
  readonly tags?: readonly string[];
  /** Source identifier (e.g., 'session-stop', 'user-explicit') */
  readonly source?: string;
}

/**
 * Memory repository read operations.
 */
export interface IMemoryRepositoryReader {
  /**
   * Find facts by group IDs with optional filtering and sorting.
   * @param groupIds - Group IDs to search (hierarchical)
   * @param options - Query options (sort, limit, tags, etc.)
   */
  findByGroupIds(
    groupIds: readonly string[],
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult>;

  /**
   * Semantic search across facts.
   * Note: Only supported by MCP and Zep backends.
   * @param groupIds - Group IDs to search
   * @param query - Search query
   * @param options - Additional options (limit, tags, etc.)
   */
  search(
    groupIds: readonly string[],
    query: string,
    options?: Omit<IQueryOptions, 'query'>
  ): Promise<IMemoryQueryResult>;

  /**
   * Find facts by tags.
   * @param groupIds - Group IDs to search
   * @param tags - Tags to filter by
   * @param options - Additional options
   */
  findByTags(
    groupIds: readonly string[],
    tags: readonly string[],
    options?: Omit<IQueryOptions, 'tags'>
  ): Promise<IMemoryQueryResult>;
}

/**
 * Memory repository write operations.
 */
export interface IMemoryRepositoryWriter {
  /**
   * Save a new fact to memory.
   * @param groupId - Group ID to save to
   * @param content - Fact content
   * @param options - Save options (tags, source)
   */
  save(
    groupId: string,
    content: string,
    options?: IMemorySaveOptions
  ): Promise<IMemoryItem>;

  /**
   * Save multiple facts in batch.
   * @param groupId - Group ID to save to
   * @param facts - Facts to save
   * @param options - Save options (tags, source)
   */
  saveBatch(
    groupId: string,
    facts: readonly string[],
    options?: IMemorySaveOptions
  ): Promise<readonly IMemoryItem[]>;
}

/**
 * Memory repository capabilities.
 */
export interface IMemoryRepositoryCapabilities {
  /**
   * Check if this repository supports semantic search.
   * Neo4j direct does not; MCP and Zep do.
   */
  supportsSemanticSearch(): boolean;

  /**
   * Check if this repository supports date-ordered queries.
   * All backends support this, but Neo4j is most efficient.
   */
  supportsDateOrdering(): boolean;

  /**
   * Check if this repository supports write operations.
   * Neo4j direct is read-only; MCP and Zep support writes.
   */
  supportsWrite(): boolean;
}

/**
 * Complete memory repository interface.
 */
export interface IMemoryRepository
  extends IMemoryRepositoryReader,
    IMemoryRepositoryWriter,
    IMemoryRepositoryCapabilities {}

/**
 * Read-only memory repository (e.g., Neo4j direct).
 */
export interface IReadOnlyMemoryRepository
  extends IMemoryRepositoryReader,
    IMemoryRepositoryCapabilities {}
