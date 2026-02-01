/**
 * Curation Service Implementation.
 *
 * Marks facts with curation status (authoritative, draft, deprecated, needs-review)
 * and computes quality scores for ranking facts by reliability.
 *
 * Detection only — delegates mutations to the underlying memory service.
 *
 * Part of Phase 5C: Curation & Compaction.
 */

import type { IMemoryItem } from '../../domain/interfaces/types';
import type { ICurationService, CurationMark } from '../../domain/interfaces/ICurationService';
import type { IMemoryWriter } from '../../domain/interfaces/IMemoryService';
import { resolveCurationTag } from '../../domain/interfaces/ICurationService';
import {
  parseConfidenceTag,
  parseSourceTag,
  CONFIDENCE_SCORES,
  resolveConfidenceTag,
} from '../../domain/interfaces/types/IMemoryQuality';
import type { ConfidenceLevel, SourceType } from '../../domain/interfaces/types/IMemoryQuality';

/**
 * Source weight map for quality score computation.
 * Higher weight = more reliable source.
 */
const SOURCE_WEIGHTS: Readonly<Record<SourceType, number>> = {
  'user-explicit': 1.0,
  'code-analysis': 0.8,
  'session-capture': 0.7,
  'external-sync': 0.6,
  'prompt-capture': 0.4,
  'auto-inferred': 0.3,
};

/**
 * Default source weight when no source tag is present.
 */
const DEFAULT_SOURCE_WEIGHT = 0.5;

/**
 * Default confidence level when no confidence tag is present.
 */
const DEFAULT_CONFIDENCE: ConfidenceLevel = 'medium';

/**
 * Recency thresholds in milliseconds.
 */
const RECENCY_FULL_BONUS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECENCY_DECAY_END_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const RECENCY_MIN_BONUS = 0.5;

/**
 * Compute recency bonus for a fact.
 * 1.0 for facts < 7 days old, decays linearly to 0.5 at 90 days.
 *
 * @param createdAt - ISO timestamp or Date of fact creation
 * @param now - Current time (for testing)
 * @returns Recency bonus between 0.5 and 1.0
 */
export function computeRecencyBonus(createdAt: string | Date | undefined, now: Date = new Date()): number {
  if (!createdAt) return RECENCY_MIN_BONUS;

  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  if (isNaN(created.getTime())) return RECENCY_MIN_BONUS;
  const ageMs = now.getTime() - created.getTime();

  if (ageMs <= RECENCY_FULL_BONUS_MS) return 1.0;
  if (ageMs >= RECENCY_DECAY_END_MS) return RECENCY_MIN_BONUS;

  // Linear decay from 1.0 to 0.5 between 7 and 90 days
  const decayRange = RECENCY_DECAY_END_MS - RECENCY_FULL_BONUS_MS;
  const decayProgress = (ageMs - RECENCY_FULL_BONUS_MS) / decayRange;
  return 1.0 - decayProgress * (1.0 - RECENCY_MIN_BONUS);
}

/**
 * Create a CurationService.
 *
 * @param memoryWriter - Memory writer for mutations (addFact for tags, expireFact for deprecated)
 */
export function createCurationService(
  memoryWriter: IMemoryWriter
): ICurationService {
  return {
    async markFact(
      groupId: string,
      uuid: string,
      mark: CurationMark
    ): Promise<void> {
      const curationTag = resolveCurationTag(mark);

      // Add the curation tag to the fact
      await memoryWriter.addFact(groupId, `__curate:${uuid}`, [curationTag]);

      // Side effects by mark
      if (mark === 'deprecated') {
        await memoryWriter.expireFact(groupId, uuid);
      }

      if (mark === 'authoritative') {
        // Promote confidence to verified
        const confidenceTag = resolveConfidenceTag('verified');
        await memoryWriter.addFact(groupId, `__promote:${uuid}`, [confidenceTag]);
      }
    },

    computeQualityScore(item: IMemoryItem): number {
      const tags = item.tags ?? [];

      // Parse confidence from tags, default to medium
      const confidence = parseConfidenceTag(tags) ?? DEFAULT_CONFIDENCE;
      const confidenceScore = CONFIDENCE_SCORES[confidence];

      // Parse source from tags, use default weight
      const source = parseSourceTag(tags);
      const sourceWeight = source ? (SOURCE_WEIGHTS[source] ?? DEFAULT_SOURCE_WEIGHT) : DEFAULT_SOURCE_WEIGHT;

      // Compute recency bonus
      const recencyBonus = computeRecencyBonus(item.created_at);

      // Quality score = confidence × source weight × recency
      const score = confidenceScore * sourceWeight * recencyBonus;

      // Clamp to [0.0, 1.0]
      return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
    },

    rankByQuality(items: readonly IMemoryItem[]): readonly IMemoryItem[] {
      return [...items].sort((a, b) => {
        const scoreA = this.computeQualityScore(a);
        const scoreB = this.computeQualityScore(b);
        return scoreB - scoreA;
      });
    },
  };
}
