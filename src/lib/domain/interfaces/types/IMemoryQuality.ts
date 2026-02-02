/**
 * Memory Quality & Source Tracking Types
 *
 * Defines confidence levels, source types, and helper functions for
 * tracking fact provenance and quality. Follows the same tag-based
 * pattern as IMemoryLifecycle.
 *
 * Confidence levels:
 * - verified: Confirmed by user, code check, or test (1.0)
 * - high: User-stated or documented (0.8)
 * - medium: Auto-captured, consistent with other facts (0.5)
 * - low: Inferred or from low-fidelity source (0.3)
 * - uncertain: Needs verification (0.1)
 *
 * Source types:
 * - user-explicit: User directly stated via `lisa memory add`
 * - session-capture: Extracted from session stop handler
 * - prompt-capture: Captured from user prompt submit
 * - code-analysis: Inferred from code inspection
 * - auto-inferred: System-generated inference
 * - external-sync: Synced from external system (Jira, GitHub, etc.)
 */

/**
 * Confidence level for a memory fact.
 */
import type { IMemoryItem } from './IMemoryResult';

export type ConfidenceLevel = 'verified' | 'high' | 'medium' | 'low' | 'uncertain';

/**
 * All valid confidence levels, ordered from highest to lowest.
 */
export const CONFIDENCE_VALUES: readonly ConfidenceLevel[] = [
  'verified',
  'high',
  'medium',
  'low',
  'uncertain',
] as const;

/**
 * Numeric score for each confidence level (0.0 - 1.0).
 */
export const CONFIDENCE_SCORES: Readonly<Record<ConfidenceLevel, number>> = {
  verified: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
  uncertain: 0.1,
};

/**
 * Source type indicating where a fact originated.
 */
export type SourceType =
  | 'user-explicit'
  | 'session-capture'
  | 'prompt-capture'
  | 'code-analysis'
  | 'auto-inferred'
  | 'external-sync';

/**
 * All valid source types.
 */
export const SOURCE_VALUES: readonly SourceType[] = [
  'user-explicit',
  'session-capture',
  'prompt-capture',
  'code-analysis',
  'auto-inferred',
  'external-sync',
] as const;

/**
 * Default confidence level assigned for each source type.
 */
export const DEFAULT_CONFIDENCE: Readonly<Record<SourceType, ConfidenceLevel>> = {
  'user-explicit': 'high',
  'session-capture': 'medium',
  'prompt-capture': 'low',
  'code-analysis': 'medium',
  'auto-inferred': 'low',
  'external-sync': 'medium',
};

/**
 * Tag prefix used for confidence tags.
 */
const CONFIDENCE_TAG_PREFIX = 'confidence:';

/**
 * Tag prefix used for source tags.
 */
const SOURCE_TAG_PREFIX = 'source:';

/**
 * Resolve a confidence level to its corresponding tag string.
 *
 * @param level - The confidence level
 * @returns Tag string, e.g. 'confidence:high'
 */
export function resolveConfidenceTag(level: ConfidenceLevel): string {
  return `${CONFIDENCE_TAG_PREFIX}${level}`;
}

/**
 * Parse the confidence level from a tag array.
 * Looks for tags matching 'confidence:<level>'.
 *
 * @param tags - Array of tags to search
 * @returns The confidence level found, or null if none present
 */
export function parseConfidenceTag(tags: readonly string[]): ConfidenceLevel | null {
  for (const tag of tags) {
    if (tag.startsWith(CONFIDENCE_TAG_PREFIX)) {
      const level = tag.slice(CONFIDENCE_TAG_PREFIX.length) as ConfidenceLevel;
      if (CONFIDENCE_VALUES.includes(level)) {
        return level;
      }
    }
  }
  return null;
}

/**
 * Check if a string is a valid ConfidenceLevel value.
 *
 * @param value - The string to check
 * @returns true if valid confidence level
 */
export function isValidConfidence(value: string): value is ConfidenceLevel {
  return CONFIDENCE_VALUES.includes(value as ConfidenceLevel);
}

/**
 * Convert a confidence level to its numeric score.
 *
 * @param level - The confidence level
 * @returns Numeric score between 0.0 and 1.0
 */
export function confidenceToScore(level: ConfidenceLevel): number {
  return CONFIDENCE_SCORES[level];
}

/**
 * Convert a numeric score to the nearest confidence level.
 * Uses closest-match: finds the level whose score is nearest.
 *
 * @param score - Numeric score (0.0 - 1.0)
 * @returns The nearest confidence level
 */
export function scoreToConfidence(score: number): ConfidenceLevel {
  const clamped = Math.max(0, Math.min(1, score));
  let closest: ConfidenceLevel = 'uncertain';
  let minDiff = Infinity;
  for (const level of CONFIDENCE_VALUES) {
    const diff = Math.abs(CONFIDENCE_SCORES[level] - clamped);
    if (diff < minDiff) {
      minDiff = diff;
      closest = level;
    }
  }
  return closest;
}

/**
 * Resolve a source type to its corresponding tag string.
 *
 * @param source - The source type
 * @returns Tag string, e.g. 'source:user-explicit'
 */
export function resolveSourceTag(source: SourceType): string {
  return `${SOURCE_TAG_PREFIX}${source}`;
}

/**
 * Parse the source type from a tag array.
 * Looks for tags matching 'source:<type>'.
 *
 * @param tags - Array of tags to search
 * @returns The source type found, or null if none present
 */
export function parseSourceTag(tags: readonly string[]): SourceType | null {
  for (const tag of tags) {
    if (tag.startsWith(SOURCE_TAG_PREFIX)) {
      const source = tag.slice(SOURCE_TAG_PREFIX.length) as SourceType;
      if (SOURCE_VALUES.includes(source)) {
        return source;
      }
    }
  }
  return null;
}

export function computeMemoryTier(item: IMemoryItem, now: number = Date.now()): number {
  const tags = item.tags ?? [];
  const confidence = parseConfidenceTag(tags);
  const source = parseSourceTag(tags);
  const isTask = tags.some(t => t === 'type:task');
  const isActive = isTask && !tags.some(t => t === 'status:done' || t === 'status:closed');

  const createdAtMs = item.created_at ? new Date(item.created_at).getTime() : NaN;
  const age = Number.isFinite(createdAtMs) ? now - createdAtMs : Infinity;
  const hours48 = 48 * 60 * 60 * 1000;
  const hours24 = 24 * 60 * 60 * 1000;

  if (confidence === 'verified') return 1;
  if (source === 'user-explicit') return 2;
  if (confidence === 'high' && age <= hours48) return 3;
  if (isActive) return 4;
  if (confidence === 'medium' && age <= hours24) return 5;
  return 6;
}

/**
 * Check if a string is a valid SourceType value.
 *
 * @param value - The string to check
 * @returns true if valid source type
 */
export function isValidSource(value: string): value is SourceType {
  return SOURCE_VALUES.includes(value as SourceType);
}

/**
 * Get the default confidence level for a given source type.
 *
 * @param source - The source type
 * @returns The default confidence level
 */
export function defaultConfidenceForSource(source: SourceType): ConfidenceLevel {
  return DEFAULT_CONFIDENCE[source];
}
