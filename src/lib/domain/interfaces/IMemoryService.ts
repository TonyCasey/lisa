import type { IMemoryResult, IMemoryItem } from './types';
import type { IMemorySaveOptions } from './dal/IMemoryRepository';
import type { IMemoryRelationship, MemoryRelationType } from './types/IMemoryRelationship';
import type { ConfidenceLevel } from './types/IMemoryQuality';
import type { IQueryOptions, IConflictGroup } from './dal/types';

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
 * Relationship operations for memory facts.
 * Separated for Interface Segregation Principle.
 * Optional — only available when a relationship-capable backend (e.g., Neo4j) is present.
 */
export interface IMemoryRelationshipWriter {
  /**
   * Create a typed relationship between two facts.
   * @param groupId - Group ID for scoping
   * @param sourceUuid - UUID of the source fact
   * @param targetUuid - UUID of the target fact
   * @param relationType - Type of relationship
   * @param metadata - Optional annotation for the relationship
   */
  linkFacts(
    groupId: string,
    sourceUuid: string,
    targetUuid: string,
    relationType: MemoryRelationType,
    metadata?: string
  ): Promise<void>;

  /**
   * Remove a typed relationship between two facts.
   * @param groupId - Group ID for scoping
   * @param sourceUuid - UUID of the source fact
   * @param targetUuid - UUID of the target fact
   * @param relationType - Type of relationship to remove
   */
  unlinkFacts(
    groupId: string,
    sourceUuid: string,
    targetUuid: string,
    relationType: MemoryRelationType
  ): Promise<void>;

  /**
   * Get all relationships for a fact.
   * @param groupId - Group ID for scoping
   * @param uuid - UUID of the fact
   * @param relationType - Optional filter by relation type
   */
  getRelatedFacts(
    groupId: string,
    uuid: string,
    relationType?: MemoryRelationType
  ): Promise<IMemoryRelationship[]>;
}

/**
 * Full memory service interface.
 * Combines read and write operations.
 */
export interface IMemoryService extends IMemoryReader, IMemoryWriter {}

/**
 * Extended memory service with relationship support.
 * Consumers that need relationship operations can check/cast to this interface.
 */
export interface IMemoryServiceWithRelationships extends IMemoryService, IMemoryRelationshipWriter {}

/**
 * Quality read operations for memory.
 * Provides confidence filtering and conflict detection.
 * Separated for Interface Segregation Principle.
 */
export interface IMemoryQualityReader {
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
  ): Promise<IMemoryItem[]>;

  /**
   * Find groups of potentially conflicting facts.
   * Detects facts sharing topic tags but with differing content.
   * @param groupIds - Group IDs to search
   * @param topic - Optional topic to filter conflicts by
   */
  findConflicts(
    groupIds: readonly string[],
    topic?: string
  ): Promise<readonly IConflictGroup[]>;
}

/**
 * Extended memory service with quality query support.
 * Consumers that need quality operations can check/cast to this interface.
 */
export interface IMemoryServiceWithQuality extends IMemoryService, IMemoryQualityReader {}
