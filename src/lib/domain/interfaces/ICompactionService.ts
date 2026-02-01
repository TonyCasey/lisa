/**
 * Memory Compaction Service Interface
 *
 * Defines the contract for compacting old memory facts
 * into summary facts with optional archival relationships.
 * Template-based summaries; LLM-assisted summarization deferred to Phase 6.
 */

/**
 * Summary of a compacted group of facts.
 */
export interface ICompactionSummary {
  readonly topic: string;
  readonly factCount: number;
  readonly summaryText: string;
  readonly archivedUuids: readonly string[];
}

/**
 * Result of a compaction operation.
 */
export interface ICompactionResult {
  readonly groupsProcessed: number;
  readonly factsArchived: number;
  readonly summariesCreated: number;
  readonly summaries: readonly ICompactionSummary[];
}

/**
 * Options for compaction operations.
 */
export interface ICompactionOptions {
  readonly olderThan: Date;
  readonly dryRun?: boolean;
  readonly minGroupSize?: number;
}

/**
 * Memory compaction service interface.
 *
 * Groups old facts by topic, creates summary facts, and archives originals.
 */
export interface ICompactionService {
  /**
   * Compact old facts into summaries.
   * @param groupId - Group ID to compact within
   * @param options - Compaction options (date cutoff, dry run, min group size)
   */
  compact(groupId: string, options: ICompactionOptions): Promise<ICompactionResult>;

  /**
   * Preview compaction without making changes.
   * Equivalent to compact() with dryRun: true.
   * @param groupId - Group ID to preview
   * @param options - Preview options (date cutoff, min group size)
   */
  preview(groupId: string, options: Omit<ICompactionOptions, 'dryRun'>): Promise<ICompactionResult>;
}
