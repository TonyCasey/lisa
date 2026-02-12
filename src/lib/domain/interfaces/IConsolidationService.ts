/**
 * Consolidation Service Interface.
 *
 * Defines the contract for consolidating duplicate or related memory facts.
 * Supports merging facts into a single retained fact, archiving duplicates,
 * or keeping all facts unchanged.
 *
 * Part of Phase 5C: Curation & Compaction.
 */

/**
 * Action to take when consolidating facts.
 */
export type ConsolidationAction = 'merge' | 'archive-duplicates' | 'keep-all';

/**
 * All valid consolidation actions.
 */
export const CONSOLIDATION_ACTION_VALUES: readonly ConsolidationAction[] = [
  'merge',
  'archive-duplicates',
  'keep-all',
] as const;

/**
 * Result of a consolidation operation.
 */
export interface IConsolidationResult {
  /** The action that was performed */
  readonly action: ConsolidationAction;
  /** UUID of the retained (or newly created) fact */
  readonly retainedUuid: string;
  /** UUIDs of facts that were archived (expired) */
  readonly archivedUuids: readonly string[];
  /** Number of supersedes relationships created */
  readonly relationshipsCreated: number;
}

/**
 * Options for consolidation.
 */
export interface IConsolidationOptions {
  /** UUID of the fact to keep (for archive-duplicates). Defaults to newest. */
  retainUuid?: string;
  /** Merged text for the new fact (for merge action). */
  mergedText?: string;
}

/**
 * Consolidation service interface.
 *
 * Provides operations for consolidating duplicate or related facts.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface IConsolidationService {
  /**
   * Consolidate a set of facts.
   *
   * Actions:
   * - `merge`: Create new fact with mergedText, expire all originals,
   *   create supersedes relationships from new fact to each original
   * - `archive-duplicates`: Keep the fact with retainUuid (or newest),
   *   expire the rest, create supersedes relationships
   * - `keep-all`: No-op, return empty result
   *
   * @param factUuids - UUIDs of facts to consolidate (minimum 2)
   * @param action - Consolidation action to perform
   * @param options - Additional options (retainUuid, mergedText)
   * @throws Error if fewer than 2 UUIDs provided
   * @throws Error if retainUuid is not in the provided UUIDs
   */
  consolidate(
    factUuids: readonly string[],
    action: ConsolidationAction,
    options?: IConsolidationOptions
  ): Promise<IConsolidationResult>;
}
