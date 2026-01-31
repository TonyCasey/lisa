/**
 * Memory service interface for skill scripts.
 * Provides a clean API for memory/fact CRUD operations.
 */

import type { ConfidenceLevel, SourceType } from '../../../../domain/interfaces/types/IMemoryQuality';

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
  tags?: string[];
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
  confidence?: ConfidenceLevel;
  sourceType?: SourceType;
}

/**
 * Options for loading memories with date filtering.
 */
export interface IMemoryLoadOptions {
  since?: Date;
  until?: Date;
  minConfidence?: ConfidenceLevel;
  showMetadata?: boolean;
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
 * Result of a memory verify operation.
 */
export interface IMemoryVerifyResult {
  status: 'ok';
  action: 'verify';
  group: string;
  uuid: string;
  previousConfidence: ConfidenceLevel | null;
  newConfidence: 'verified';
  mode: 'neo4j';
}

/**
 * Options for curation listing.
 */
export interface ICurateOptions {
  since?: string;
  minConfidence?: ConfidenceLevel;
  limit?: number;
}

/**
 * A fact enriched with parsed quality metadata for curation.
 */
export interface ICurateFact {
  uuid: string;
  fact: string;
  confidence: ConfidenceLevel | null;
  source: SourceType | null;
  lifecycle: string | null;
  created_at: string;
  age: string;
  tags: string[];
}

/**
 * Result of a memory curate operation.
 */
export interface IMemoryCurateResult {
  status: 'ok';
  action: 'curate';
  group: string;
  facts: ICurateFact[];
  totalReviewed: number;
  mode: 'neo4j';
}

/**
 * A group of potentially conflicting facts.
 */
export interface IConflictGroupResult {
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
  conflicts: IConflictGroupResult[];
  totalGroups: number;
  mode: 'neo4j';
}

/**
 * Memory service interface.
 */
export interface IMemoryService {
  /**
   * Load memories/facts from storage.
   * Always uses Neo4j direct for better date ordering.
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
   */
  add(
    text: string,
    groupId: string,
    options: IMemoryAddOptions
  ): Promise<IMemoryAddResult>;

  /**
   * Expire a single fact by UUID.
   * Uses Neo4j direct to set expired_at.
   */
  expire(
    groupId: string,
    uuid: string
  ): Promise<IMemoryExpireResult>;

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   * Expires session facts >24h and ephemeral facts >1h.
   */
  cleanup(
    groupId: string,
    dryRun: boolean
  ): Promise<IMemoryCleanupResult>;

  /**
   * Verify a fact, upgrading its confidence to 'verified'.
   * Expires original and re-creates with verified confidence.
   */
  verify(
    groupId: string,
    uuid: string
  ): Promise<IMemoryVerifyResult>;

  /**
   * List facts for curation review with full quality metadata.
   * Sorted by confidence ascending (lowest first for review).
   */
  curate(
    groupId: string,
    groupIds: string[],
    options: ICurateOptions
  ): Promise<IMemoryCurateResult>;

  /**
   * Detect and group potentially conflicting facts.
   */
  conflicts(
    groupIds: string[],
    topic?: string
  ): Promise<IMemoryConflictsResult>;
}
