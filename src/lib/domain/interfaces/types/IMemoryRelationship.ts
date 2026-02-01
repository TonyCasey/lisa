/**
 * Memory Relationship Types
 *
 * Defines typed relationships between memory facts, enabling structured
 * knowledge graphs where decisions can supersede others, facts can support
 * or contradict each other, and implementations can be linked to decisions.
 *
 * Relationship types:
 * - supersedes: One fact replaces another (e.g., a new decision overrides an old one)
 * - supports: Evidence backing a decision or fact
 * - contradicts: Conflicting information between facts
 * - implements: Implementation of a decision or plan
 * - relates_to: General association (catch-all)
 * - refines: Clarification or narrowing of a fact
 */

/**
 * Typed relationship between two memory facts.
 */
export type MemoryRelationType =
  | 'supersedes'
  | 'supports'
  | 'contradicts'
  | 'implements'
  | 'relates_to'
  | 'refines';

/**
 * All valid memory relation type values.
 */
export const MEMORY_RELATION_VALUES: readonly MemoryRelationType[] = [
  'supersedes',
  'supports',
  'contradicts',
  'implements',
  'relates_to',
  'refines',
] as const;

/**
 * A relationship between two memory facts.
 */
export interface IMemoryRelationship {
  readonly sourceUuid: string;
  readonly targetUuid: string;
  readonly relationType: MemoryRelationType;
  readonly metadata?: string;
  readonly createdAt?: string;
}

/**
 * Human-readable labels for each relation type.
 */
export const RELATION_LABELS: Readonly<Record<MemoryRelationType, string>> = {
  supersedes: 'supersedes',
  supports: 'supports',
  contradicts: 'contradicts',
  implements: 'implements',
  relates_to: 'relates to',
  refines: 'refines',
};

/**
 * Inverse labels for display (how the target describes its relationship to the source).
 */
export const INVERSE_RELATIONS: Readonly<Record<MemoryRelationType, string>> = {
  supersedes: 'superseded by',
  supports: 'supported by',
  contradicts: 'contradicted by',
  implements: 'implemented by',
  relates_to: 'related to',
  refines: 'refined by',
};

/**
 * Check if a string is a valid MemoryRelationType value.
 *
 * @param value - The string to check
 * @returns true if valid relation type
 */
export function isValidRelationType(value: string): value is MemoryRelationType {
  return MEMORY_RELATION_VALUES.includes(value as MemoryRelationType);
}
