/**
 * Memory service interface for skill scripts.
 * Provides a clean API for memory/fact CRUD operations.
 */
import type { CurationMark } from '../../../../domain/interfaces/ICurationService';
import type { ConsolidationAction } from '../../../../domain/interfaces/IConsolidationService';

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
 * A group of potentially conflicting facts sharing a topic.
 */
export interface IConflictGroup {
  topic: string;
  facts: IFact[];
  detectedAt: string;
}

/**
 * Result of a memory conflicts operation.
 */
export interface IMemoryConflictsResult {
  status: 'ok';
  action: 'conflicts';
  group: string;
  groups: string[];
  topic: string;
  conflictGroups: IConflictGroup[];
  totalConflicts: number;
  mode: 'neo4j';
}

/**
 * A group of duplicate facts detected by deduplication.
 */
export interface IDuplicateGroup {
  reason: 'exact-match' | 'tag-overlap' | 'similar-content';
  facts: IFact[];
  similarity: number;
}

/**
 * Result of a memory deduplication scan.
 */
export interface IMemoryDedupeResult {
  status: 'ok';
  action: 'dedupe';
  group: string;
  totalFactsScanned: number;
  duplicateGroups: IDuplicateGroup[];
  totalDuplicates: number;
  minSimilarity: number;
  mode: 'neo4j';
}

/**
 * Result of a memory curate operation.
 */
export interface IMemoryCurateResult {
  status: 'ok';
  action: 'curate';
  group: string;
  uuid: string;
  mark: CurationMark;
  mode: 'neo4j';
}

/**
 * Result of a memory consolidate operation.
 */
export interface IMemoryConsolidateResult {
  status: 'ok';
  action: 'consolidate';
  group: string;
  consolidationAction: ConsolidationAction;
  retainedUuid: string;
  archivedUuids: string[];
  relationshipsCreated: number;
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
   * Find groups of potentially conflicting facts.
   * Detects facts sharing a type:* tag but with differing content.
   *
   * @param groupIds - Group identifiers to search
   * @param topic - Optional topic tag to filter by
   */
  conflicts(
    groupIds: string[],
    topic?: string
  ): Promise<IMemoryConflictsResult>;

  /**
   * Detect duplicate facts within a group.
   * Three-pass detection: exact match, tag overlap, Jaccard similarity.
   *
   * @param groupId - Group identifier to scan
   * @param options - Detection options
   */
  dedupe(
    groupId: string,
    options?: { minSimilarity?: number; limit?: number; since?: Date }
  ): Promise<IMemoryDedupeResult>;

  /**
   * Mark a fact with a curation status.
   *
   * @param groupId - Group identifier
   * @param uuid - UUID of the fact to mark
   * @param mark - Curation mark (authoritative, draft, deprecated, needs-review)
   */
  curate(
    groupId: string,
    uuid: string,
    mark: CurationMark
  ): Promise<IMemoryCurateResult>;

  /**
   * Consolidate multiple facts.
   *
   * @param groupId - Group identifier
   * @param factUuids - UUIDs of facts to consolidate (minimum 2)
   * @param action - Consolidation action (merge, archive-duplicates, keep-all)
   * @param options - Additional options (retainUuid, mergedText)
   */
  consolidate(
    groupId: string,
    factUuids: string[],
    action: ConsolidationAction,
    options?: { retainUuid?: string; mergedText?: string }
  ): Promise<IMemoryConsolidateResult>;
}
