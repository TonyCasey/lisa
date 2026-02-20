/**
 * Curation Service Interface.
 *
 * Defines the contract for curating memory facts — marking them as
 * authoritative, draft, deprecated, or needing review. Also provides
 * quality scoring to rank facts by reliability.
 *
 * Part of Phase 5C: Curation & Compaction.
 */

import type { IMemoryItem } from './types';

/**
 * Curation mark for a memory fact.
 */
export type CurationMark = 'authoritative' | 'draft' | 'deprecated' | 'needs-review';

/**
 * All valid curation marks.
 */
export const CURATION_MARK_VALUES: readonly CurationMark[] = [
  'authoritative',
  'draft',
  'deprecated',
  'needs-review',
] as const;

/**
 * Tag prefix used for curation tags.
 */
const CURATION_TAG_PREFIX = 'curated:';

/**
 * Check if a string is a valid CurationMark.
 *
 * @param value - The string to check
 * @returns true if valid curation mark
 */
export function isValidCurationMark(value: string): value is CurationMark {
  return CURATION_MARK_VALUES.includes(value as CurationMark);
}

/**
 * Resolve a curation mark to its corresponding tag string.
 *
 * @param mark - The curation mark
 * @returns Tag string, e.g. 'curated:authoritative'
 */
export function resolveCurationTag(mark: CurationMark): string {
  return `${CURATION_TAG_PREFIX}${mark}`;
}

/**
 * Parse the curation mark from a tag array.
 * Looks for tags matching 'curated:<mark>'.
 *
 * @param tags - Array of tags to search
 * @returns The curation mark found, or null if none present
 */
export function parseCurationTag(tags: readonly string[]): CurationMark | null {
  for (const tag of tags) {
    if (tag.startsWith(CURATION_TAG_PREFIX)) {
      const mark = tag.slice(CURATION_TAG_PREFIX.length) as CurationMark;
      if (CURATION_MARK_VALUES.includes(mark)) {
        return mark;
      }
    }
  }
  return null;
}

/**
 * Curation service interface.
 *
 * Provides operations for curating facts (marking quality)
 * and computing quality scores for ranking.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface ICurationService {
  /**
   * Mark a fact with a curation status.
   *
   * Side effects by mark:
   * - `deprecated`: Also expires the fact
   * - `authoritative`: Promotes confidence to `verified`
   *
   * @param uuid - UUID of the fact to mark
   * @param mark - The curation mark to apply
   */
  markFact(
    uuid: string,
    mark: CurationMark
  ): Promise<void>;

  /**
   * Compute a quality score for a memory item.
   *
   * Formula: confidenceScore × sourceWeight × recencyBonus
   * - confidenceScore: from CONFIDENCE_SCORES (0.1–1.0)
   * - sourceWeight: varies by source type (0.3–1.0)
   * - recencyBonus: 1.0 for <7 days, decays linearly to 0.5 at 90 days
   *
   * @param item - The memory item to score
   * @returns Quality score between 0.0 and 1.0
   */
  computeQualityScore(item: IMemoryItem): number;

  /**
   * Sort memory items by quality score descending.
   * Returns a new sorted array (immutable).
   *
   * @param items - Items to rank
   * @returns New array sorted by quality score descending
   */
  rankByQuality(items: readonly IMemoryItem[]): readonly IMemoryItem[];
}
