/**
 * Type and tag mappings for memory classification.
 * Used to automatically tag memories based on type or text prefix.
 */

/**
 * Entity type to tag mapping.
 * Used with --type flag to set semantic tags.
 */
export const TYPE_MAP: Record<string, string> = {
  // Code & Architecture
  decision: 'code:decision',
  pattern: 'code:pattern',
  dependency: 'code:dependency',
  'tech-debt': 'code:tech-debt',
  // Context & History
  bug: 'context:bug',
  rationale: 'context:rationale',
  failed: 'context:failed',
  quirk: 'context:quirk',
  // External
  feedback: 'external:feedback',
  incident: 'external:incident',
  contract: 'external:contract',
  // People & Process
  contributor: 'people:contributor',
  review: 'people:review',
  blocker: 'people:blocker',
  estimate: 'people:estimate',
  // Project
  'scope-in': 'project:scope-in',
  'scope-out': 'project:scope-out',
  milestone: 'project:milestone',
  'init-review': 'type:init-review',
  // GitHub PR
  'pr-merged': 'github:pr-merged',
  'pr-note': 'github:pr',
  // Lifecycle
  permanent: 'lifecycle:permanent',
  project: 'lifecycle:project',
  session: 'lifecycle:session',
  ephemeral: 'lifecycle:ephemeral',
};

/**
 * Auto-detect prefixes in text.
 * When text starts with these prefixes, the corresponding tag is applied.
 */
export const PREFIX_MAP: Record<string, string> = {
  'DECISION:': 'code:decision',
  'PATTERN:': 'code:pattern',
  'TECH-DEBT:': 'code:tech-debt',
  'BUG:': 'context:bug',
  'RATIONALE:': 'context:rationale',
  'FAILED:': 'context:failed',
  'INCIDENT:': 'external:incident',
  'BLOCKER:': 'people:blocker',
  'SCOPE-IN:': 'project:scope-in',
  'SCOPE-OUT:': 'project:scope-out',
  'INIT-REVIEW:': 'type:init-review',
  'MILESTONE:': 'project:milestone',
  'FEATURE:': 'project:feature',
  'REFACTOR:': 'code:refactor',
  // GitHub PR
  'PR MERGED:': 'github:pr-merged',
  'PR:': 'github:pr',
};

/**
 * Detect tag from text prefix.
 *
 * @param text - Text to check for prefix
 * @returns Tag if prefix found, null otherwise
 */
export function detectPrefixTag(text: string): string | null {
  const upperText = text.toUpperCase();
  for (const [prefix, tag] of Object.entries(PREFIX_MAP)) {
    if (upperText.startsWith(prefix)) {
      return tag;
    }
  }
  return null;
}

/**
 * Resolve tag from explicit flag, type mapping, or text prefix.
 *
 * @param text - Memory text content
 * @param explicitTag - Explicit --tag flag value
 * @param entityType - Explicit --type flag value
 * @returns Resolved tag or undefined
 */
export function resolveTag(
  text: string,
  explicitTag: string | null | undefined,
  entityType: string | null | undefined
): string | undefined {
  if (explicitTag) return explicitTag;
  if (entityType && TYPE_MAP[entityType]) return TYPE_MAP[entityType];
  const prefixTag = detectPrefixTag(text);
  if (prefixTag) return prefixTag;
  return undefined;
}
