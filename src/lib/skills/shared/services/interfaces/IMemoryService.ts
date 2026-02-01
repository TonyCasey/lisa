/**
 * Memory service interface for skill scripts.
 * Provides a clean API for memory/fact CRUD operations.
 */

/**
 * A memory/fact item.
 */
export interface IFact {
  uuid: string;
  name: string;
  fact: string;
  group_id: string;
  created_at: string;
  valid_at?: string;
  expired_at?: string | null;
}

/**
 * Result of a memory load operation.
 */
export interface IMemoryLoadResult {
  status: 'ok';
  action: 'load';
  group: string;
  groups: string[];
  query: string;
  facts: IFact[];
  mode: 'neo4j' | 'mcp' | 'zep-cloud';
}

/**
 * Result of a memory add operation.
 */
export interface IMemoryAddResult {
  status: 'ok';
  action: 'add';
  group: string;
  text: string;
  tag?: string;
  result?: unknown;
  message_uuid?: string;
  mode: 'mcp' | 'zep-cloud';
}

/**
 * Options for adding a memory.
 */
export interface IMemoryAddOptions {
  tag?: string | null;
  type?: string;
  source?: string;
  ttl?: number;
}

/**
 * Options for loading memories with date filtering.
 */
export interface IMemoryLoadOptions {
  since?: Date;
  until?: Date;
}

/**
 * Result of a memory expire operation.
 */
export interface IMemoryExpireResult {
  status: 'ok';
  action: 'expire';
  group: string;
  uuid: string;
  found: boolean;
  mode: 'neo4j';
}

/**
 * Result of a memory cleanup operation.
 */
export interface IMemoryCleanupResult {
  status: 'ok';
  action: 'cleanup';
  group: string;
  expiredCount: number;
  dryRun: boolean;
  mode: 'neo4j';
}

/**
 * A relationship between two memory facts.
 */
export interface IMemoryRelationshipItem {
  sourceUuid: string;
  targetUuid: string;
  relationType: string;
  metadata?: string;
  created_at?: string;
}

/**
 * Result of a memory link operation.
 */
export interface IMemoryLinkResult {
  status: 'ok';
  action: 'link';
  group: string;
  sourceUuid: string;
  targetUuid: string;
  relationType: string;
  mode: 'neo4j';
}

/**
 * Result of a memory links query operation.
 */
export interface IMemoryLinksResult {
  status: 'ok';
  action: 'links';
  group: string;
  uuid: string;
  relationships: IMemoryRelationshipItem[];
  mode: 'neo4j';
}

/**
 * Memory service interface.
 */
export interface IMemoryService {
  /**
   * Load memories/facts from storage.
   * Always uses Neo4j direct for better date ordering.
   *
   * @param groupIds - Group identifiers to search
   * @param query - Optional search query (empty string or '*' for all)
   * @param limit - Maximum number of facts to return
   * @param options - Optional date filtering options
   */
  load(
    groupIds: string[],
    query: string,
    limit: number,
    options?: IMemoryLoadOptions
  ): Promise<IMemoryLoadResult>;

  /**
   * Add a new memory/fact.
   * Uses MCP or Zep depending on configuration.
   *
   * @param text - Memory text content
   * @param groupId - Group identifier for storage
   * @param options - Additional options (tag, type, source)
   */
  add(
    text: string,
    groupId: string,
    options: IMemoryAddOptions
  ): Promise<IMemoryAddResult>;

  /**
   * Expire a single fact by UUID.
   * Uses Neo4j direct to set expired_at.
   *
   * @param groupId - Group identifier
   * @param uuid - UUID of the fact to expire
   */
  expire(
    groupId: string,
    uuid: string
  ): Promise<IMemoryExpireResult>;

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   * Expires session facts >24h and ephemeral facts >1h.
   *
   * @param groupId - Group identifier
   * @param dryRun - If true, count without expiring
   */
  cleanup(
    groupId: string,
    dryRun: boolean
  ): Promise<IMemoryCleanupResult>;

  /**
   * Create a typed relationship between two facts.
   * Requires Neo4j backend.
   *
   * @param groupId - Group identifier
   * @param sourceUuid - UUID of the source fact
   * @param targetUuid - UUID of the target fact
   * @param relationType - Type of relationship
   * @param metadata - Optional annotation
   */
  linkFacts(
    groupId: string,
    sourceUuid: string,
    targetUuid: string,
    relationType: string,
    metadata?: string
  ): Promise<IMemoryLinkResult>;

  /**
   * Get relationships for a fact.
   * Requires Neo4j backend.
   *
   * @param groupId - Group identifier
   * @param uuid - UUID of the fact to query
   * @param relationType - Optional filter by relation type
   */
  getRelatedFacts(
    groupId: string,
    uuid: string,
    relationType?: string
  ): Promise<IMemoryLinksResult>;
}
