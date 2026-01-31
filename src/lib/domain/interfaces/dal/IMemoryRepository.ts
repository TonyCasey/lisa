/**
 * Memory Repository Interface
 *
 * Contract for memory data access operations.
 * Implementations may use MCP, Neo4j, or Zep Cloud as backend.
 */

import { IMemoryItem } from '../types/IMemoryResult';
import type { MemoryLifecycle } from '../types/IMemoryLifecycle';
import type { ConfidenceLevel, SourceType } from '../types/IMemoryQuality';
import { IQueryOptions, IMemoryQueryResult, IExpirationFilter, IConflictGroup } from './types';

/**
 * Options for saving memory.
 */
export interface IMemorySaveOptions {
  /** Tags to apply to the memory */
  readonly tags?: readonly string[];
  /** Source identifier (e.g., 'session-stop', 'user-explicit') */
  readonly source?: string;
  /** Lifecycle tier for retention control */
  readonly lifecycle?: MemoryLifecycle;
  /** Custom TTL override in milliseconds (overrides lifecycle default) */
  readonly ttlMs?: number;
  /** Confidence level for the fact */
  readonly confidence?: ConfidenceLevel;
  /** Source type for provenance tracking */
  readonly sourceType?: SourceType;
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
 * Expiration operations for memory repositories.
 * Separated interface since not all backends support direct expiration.
 */
export interface IMemoryRepositoryExpiration {
  /**
   * Expire a single fact by UUID.
   * Sets expired_at timestamp on the fact.
   * @param groupId - Group ID the fact belongs to
   * @param uuid - UUID of the fact to expire
   */
  expire(groupId: string, uuid: string): Promise<void>;

  /**
   * Expire facts matching a filter.
   * @param groupId - Group ID to filter within
   * @param filter - Expiration filter criteria
   * @returns Number of facts expired
   */
  expireByFilter(groupId: string, filter: IExpirationFilter): Promise<number>;
}

/**
 * Quality operations for memory repositories.
 * Separated interface since not all backends support quality queries.
 */
export interface IMemoryRepositoryQuality {
  /**
   * Find facts at or above a minimum confidence level.
   * @param groupIds - Group IDs to search
   * @param minLevel - Minimum confidence level (inclusive)
   * @param options - Additional query options
   */
  findByMinConfidence(
    groupIds: readonly string[],
    minLevel: ConfidenceLevel,
    options?: IQueryOptions
  ): Promise<IMemoryQueryResult>;

  /**
   * Find groups of potentially conflicting facts.
   * Detects facts sharing topic tags but with differing content.
   * @param groupIds - Group IDs to search
   * @param topic - Optional topic to filter conflicts by
   * @param options - Additional query options
   */
  findConflicts(
    groupIds: readonly string[],
    topic?: string,
    options?: IQueryOptions
  ): Promise<readonly IConflictGroup[]>;
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

/**
 * Read-only memory repository with expiration support (e.g., Neo4j direct).
 */
export interface IReadOnlyMemoryRepositoryWithExpiration
  extends IReadOnlyMemoryRepository,
    IMemoryRepositoryExpiration {}

/**
 * Read-only memory repository with expiration and quality support.
 */
export interface IReadOnlyMemoryRepositoryWithQuality
  extends IReadOnlyMemoryRepositoryWithExpiration,
    IMemoryRepositoryQuality {}
