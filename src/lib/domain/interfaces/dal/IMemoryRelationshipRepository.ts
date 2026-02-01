/**
 * Memory Relationship Repository Interface.
 *
 * Contract for storing and querying typed relationships between memory facts.
 * Implementations may use Neo4j (MEMORY_RELATION edges) or other graph backends.
 */

import type { IMemoryRelationship, MemoryRelationType } from '../types/IMemoryRelationship';

/**
 * Options for querying memory relationships.
 */
export interface IRelationshipQueryOptions {
  /** Filter by relation type */
  readonly relationType?: MemoryRelationType;
  /** Direction of relationships to query */
  readonly direction?: 'outgoing' | 'incoming' | 'both';
}

/**
 * Repository for memory fact relationships.
 */
export interface IMemoryRelationshipRepository {
  /**
   * Create a relationship between two memory facts.
   *
   * @param groupId - Group ID for scoping
   * @param relationship - The relationship to create (without createdAt)
   */
  createRelationship(
    groupId: string,
    relationship: Omit<IMemoryRelationship, 'createdAt'>
  ): Promise<void>;

  /**
   * Find relationships for a memory fact.
   *
   * @param groupId - Group ID for scoping
   * @param uuid - UUID of the fact to find relationships for
   * @param options - Optional query filters (type, direction)
   */
  findRelationships(
    groupId: string,
    uuid: string,
    options?: IRelationshipQueryOptions
  ): Promise<readonly IMemoryRelationship[]>;

  /**
   * Remove a specific relationship between two facts.
   *
   * @param groupId - Group ID for scoping
   * @param sourceUuid - UUID of the source fact
   * @param targetUuid - UUID of the target fact
   * @param relationType - Type of relationship to remove
   */
  removeRelationship(
    groupId: string,
    sourceUuid: string,
    targetUuid: string,
    relationType: MemoryRelationType
  ): Promise<void>;
}
