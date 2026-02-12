/**
 * Memory service interface for skill scripts.
 * Provides a clean API for memory/fact CRUD operations.
 *
 * This is the "rich" memory interface used by CLI scripts,
 * with operations like dedupe, curate, conflicts, consolidate.
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */
import type { CurationMark } from '../../../domain/interfaces/ICurationService';
import type { ConsolidationAction } from '../../../domain/interfaces/IConsolidationService';

/**
 * A memory/fact item.
 */
export interface IFact {
  uuid: string;
  name: string;
  fact: string;
  created_at: string;
  valid_at?: string;
  expired_at?: string | null;
}

/**
 * Backend mode for memory operations.
 */
export type MemoryMode = 'git-mem';

/**
 * Result of a memory load operation.
 */
export interface IMemoryLoadResult {
  status: 'ok';
  action: 'load';
  query: string;
  facts: IFact[];
  mode: MemoryMode;
}

/**
 * Result of a memory add operation.
 */
export interface IMemoryAddResult {
  status: 'ok';
  action: 'add';
  text: string;
  tag?: string;
  result?: unknown;
  message_uuid?: string;
  mode: MemoryMode;
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
  uuid: string;
  found: boolean;
  mode: MemoryMode;
}

/**
 * Result of a memory cleanup operation.
 */
export interface IMemoryCleanupResult {
  status: 'ok';
  action: 'cleanup';
  expiredCount: number;
  dryRun: boolean;
  mode: MemoryMode;
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
  topic: string;
  conflictGroups: IConflictGroup[];
  totalConflicts: number;
  mode: MemoryMode;
}

/**
 * A group of duplicate facts detected by deduplication.
 */
export interface IDuplicateGroup {
  reason: 'exact-match' | 'tag-overlap' | 'similar-content' | 'llm-semantic';
  facts: IFact[];
  similarity: number;
  suggestedMerge?: string;
}

/**
 * Result of a memory deduplication scan.
 */
export interface IMemoryDedupeResult {
  status: 'ok';
  action: 'dedupe';
  totalFactsScanned: number;
  duplicateGroups: IDuplicateGroup[];
  totalDuplicates: number;
  minSimilarity: number;
  mode: MemoryMode;
}

/**
 * Result of a memory curate operation.
 */
export interface IMemoryCurateResult {
  status: 'ok';
  action: 'curate';
  uuid: string;
  mark: CurationMark;
  mode: MemoryMode;
}

/**
 * Result of a memory consolidate operation.
 */
export interface IMemoryConsolidateResult {
  status: 'ok';
  action: 'consolidate';
  consolidationAction: ConsolidationAction;
  retainedUuid: string;
  archivedUuids: string[];
  relationshipsCreated: number;
  mode: MemoryMode;
}

/**
 * Memory service interface for skill scripts.
 *
 * This is the "rich" interface with full CLI capabilities.
 * Contrast with IMemoryService in domain/interfaces which is
 * the simpler infrastructure interface.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping.
 */
export interface ISkillMemoryService {
  /**
   * Load memories/facts from storage.
   *
   * @param query - Optional search query (empty string or '*' for all)
   * @param limit - Maximum number of facts to return
   * @param options - Optional date filtering options
   */
  load(
    query: string,
    limit: number,
    options?: IMemoryLoadOptions
  ): Promise<IMemoryLoadResult>;

  /**
   * Add a new memory/fact.
   *
   * @param text - Memory text content
   * @param options - Additional options (tag, type, source)
   */
  add(text: string, options: IMemoryAddOptions): Promise<IMemoryAddResult>;

  /**
   * Expire a single fact by UUID.
   *
   * @param uuid - UUID of the fact to expire
   */
  expire(uuid: string): Promise<IMemoryExpireResult>;

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   *
   * @param dryRun - If true, count without expiring
   */
  cleanup(dryRun: boolean): Promise<IMemoryCleanupResult>;

  /**
   * Find groups of potentially conflicting facts.
   *
   * @param topic - Optional topic tag to filter by
   */
  conflicts(topic?: string): Promise<IMemoryConflictsResult>;

  /**
   * Detect duplicate facts.
   *
   * @param options - Detection options
   */
  dedupe(
    options?: { minSimilarity?: number; limit?: number; since?: Date }
  ): Promise<IMemoryDedupeResult>;

  /**
   * Mark a fact with a curation status.
   *
   * @param uuid - UUID of the fact to mark
   * @param mark - Curation mark (authoritative, draft, deprecated, needs-review)
   */
  curate(uuid: string, mark: CurationMark): Promise<IMemoryCurateResult>;

  /**
   * Consolidate multiple facts.
   *
   * @param factUuids - UUIDs of facts to consolidate (minimum 2)
   * @param action - Consolidation action (merge, archive-duplicates, keep-all)
   * @param options - Additional options (retainUuid, mergedText)
   */
  consolidate(
    factUuids: string[],
    action: ConsolidationAction,
    options?: { retainUuid?: string; mergedText?: string }
  ): Promise<IMemoryConsolidateResult>;
}
