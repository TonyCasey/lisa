/**
 * Deduplication Service Interfaces.
 *
 * Domain contracts for detecting duplicate memory facts.
 * Detection only — consolidation (acting on duplicates) is separate.
 */

import type { IMemoryItem } from './types';

/**
 * Reason why facts were grouped as duplicates.
 */
export type DuplicateReason = 'exact-match' | 'tag-overlap' | 'similar-content' | 'llm-semantic';

/**
 * A group of duplicate facts.
 */
export interface IDuplicateGroup {
  /** Why these facts were grouped as duplicates */
  readonly reason: DuplicateReason;
  /** The duplicate facts */
  readonly facts: readonly IMemoryItem[];
  /** Similarity score between group members (0.0–1.0) */
  readonly similarity: number;
  /** LLM-suggested merged text for the group (only for llm-semantic groups) */
  readonly suggestedMerge?: string;
}

/**
 * Result of a deduplication scan.
 */
export interface IDeduplicationResult {
  /** Total facts scanned */
  readonly totalFactsScanned: number;
  /** Groups of detected duplicates */
  readonly duplicateGroups: readonly IDuplicateGroup[];
  /** Total number of duplicate groups found */
  readonly totalDuplicates: number;
}

/**
 * Options for deduplication detection.
 */
export interface IDeduplicationOptions {
  /** Minimum Jaccard similarity threshold for similar-content detection (default: 0.6) */
  readonly minSimilarity?: number;
  /** Maximum number of duplicate groups to return (default: 10) */
  readonly limit?: number;
  /** Only scan facts created after this date */
  readonly since?: Date;
  /** Enable LLM-assisted semantic deduplication as a 4th pass (default: false) */
  readonly aiAssist?: boolean;
}

/**
 * Deduplication detection service.
 * Detects duplicate facts without mutating them.
 */
export interface IDeduplicationService {
  /**
   * Detect duplicate facts within a group.
   *
   * Three-pass detection:
   * 1. Exact match — identical normalized text (similarity: 1.0)
   * 2. Tag overlap — same type:* tag with 3+ shared words (similarity: 0.5–0.8)
   * 3. Similar content — Jaccard similarity above threshold (similarity: configurable)
   *
   * @param groupId - Group ID to scan
   * @param options - Detection options (threshold, limit, date filter)
   */
  detectDuplicates(
    groupId: string,
    options?: IDeduplicationOptions
  ): Promise<IDeduplicationResult>;
}
