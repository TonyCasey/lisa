/**
 * Memory Lifecycle Types
 *
 * Defines lifecycle tiers for memory facts, controlling retention and expiration.
 *
 * Tiers:
 * - permanent: Never expires (e.g., project conventions, key decisions)
 * - project: Lives for the project lifetime, no automatic expiration
 * - session: Expires after 24h (e.g., session-captured work)
 * - ephemeral: Expires after 1h (e.g., user prompts, transient context)
 */

/**
 * Memory lifecycle tier.
 */
export type MemoryLifecycle = 'permanent' | 'project' | 'session' | 'ephemeral';

/**
 * All valid lifecycle values.
 */
export const LIFECYCLE_VALUES: readonly MemoryLifecycle[] = [
  'permanent',
  'project',
  'session',
  'ephemeral',
] as const;

/**
 * Default TTL (in milliseconds) for each lifecycle tier.
 * null means no automatic expiration.
 */
export const LIFECYCLE_DEFAULTS: Readonly<Record<MemoryLifecycle, number | null>> = {
  permanent: null,
  project: null,
  session: 24 * 60 * 60 * 1000,   // 24 hours
  ephemeral: 60 * 60 * 1000,       // 1 hour
};

/**
 * Tag prefix used for lifecycle tags.
 */
const LIFECYCLE_TAG_PREFIX = 'lifecycle:';

/**
 * Resolve a lifecycle tier to its corresponding tag string.
 *
 * @param lifecycle - The lifecycle tier
 * @returns Tag string, e.g. 'lifecycle:permanent'
 */
export function resolveLifecycleTag(lifecycle: MemoryLifecycle): string {
  return `${LIFECYCLE_TAG_PREFIX}${lifecycle}`;
}

/**
 * Parse the lifecycle tier from a tag array.
 * Looks for tags matching 'lifecycle:<tier>'.
 *
 * @param tags - Array of tags to search
 * @returns The lifecycle tier found, or 'project' as default
 */
export function parseLifecycleTag(tags: readonly string[]): MemoryLifecycle {
  for (const tag of tags) {
    if (tag.startsWith(LIFECYCLE_TAG_PREFIX)) {
      const tier = tag.slice(LIFECYCLE_TAG_PREFIX.length) as MemoryLifecycle;
      if (LIFECYCLE_VALUES.includes(tier)) {
        return tier;
      }
    }
  }
  return 'project';
}

/**
 * Check if a string is a valid MemoryLifecycle value.
 *
 * @param value - The string to check
 * @returns true if valid lifecycle tier
 */
export function isValidLifecycle(value: string): value is MemoryLifecycle {
  return LIFECYCLE_VALUES.includes(value as MemoryLifecycle);
}

/**
 * Compute the expiration date for a lifecycle tier.
 *
 * @param lifecycle - The lifecycle tier
 * @param ttlMs - Optional custom TTL override in milliseconds
 * @param now - Optional reference time (defaults to current time)
 * @returns Expiration Date, or null if the tier never expires
 */
export function computeExpiresAt(
  lifecycle: MemoryLifecycle,
  ttlMs?: number,
  now?: Date
): Date | null {
  const ttl = ttlMs ?? LIFECYCLE_DEFAULTS[lifecycle];
  if (ttl === null) {
    return null;
  }
  const referenceTime = now ?? new Date();
  return new Date(referenceTime.getTime() + ttl);
}
