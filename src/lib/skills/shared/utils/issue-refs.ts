/**
 * Issue reference extraction utility.
 *
 * Extracts issue references from text (commit messages, PR bodies, etc.)
 * Supports various formats:
 * - Simple: #123
 * - Cross-repo: owner/repo#123
 * - With prefix: Fixes #123, Closes owner/repo#123, Resolves #456
 * - Case insensitive prefixes
 */

/**
 * Valid prefix keywords that indicate an issue closing action.
 */
export type IssueRefPrefix = 'fixes' | 'closes' | 'resolves' | 'refs';

/**
 * Represents a parsed issue reference from text.
 */
export interface IIssueRef {
  /** The issue number */
  number: number;
  /** Optional owner (for cross-repo references) */
  owner?: string;
  /** Optional repo name (for cross-repo references) */
  repo?: string;
  /** Optional action prefix (fixes, closes, resolves, refs) */
  prefix?: IssueRefPrefix;
  /** The full matched text */
  raw: string;
}

/**
 * Result of issue reference extraction with context.
 */
export interface IIssueRefResult {
  /** All extracted issue references */
  refs: IIssueRef[];
  /** References that would close an issue (fixes, closes, resolves) */
  closingRefs: IIssueRef[];
  /** References that just mention an issue (refs, no prefix) */
  mentionRefs: IIssueRef[];
  /** Whether any closing references were found */
  hasClosingRefs: boolean;
}

/**
 * Prefixes that indicate an issue should be closed when PR/commit merges.
 */
const CLOSING_PREFIXES: readonly IssueRefPrefix[] = ['fixes', 'closes', 'resolves'];

/**
 * Extract issue references from text.
 *
 * Matches patterns like:
 * - #123
 * - owner/repo#123
 * - fixes #123
 * - Closes owner/repo#123
 * - RESOLVES #456
 *
 * @param text - Text to search (commit message, PR body, etc.)
 * @returns Array of parsed issue references
 *
 * @example
 * ```typescript
 * extractIssueRefs('Fixes #123 and refs owner/repo#456')
 * // Returns:
 * // [
 * //   { number: 123, prefix: 'fixes', raw: 'Fixes #123' },
 * //   { number: 456, owner: 'owner', repo: 'repo', prefix: 'refs', raw: 'refs owner/repo#456' }
 * // ]
 * ```
 */
export function extractIssueRefs(text: string): IIssueRef[] {
  if (!text) return [];

  const refs: IIssueRef[] = [];

  // Pattern explanation:
  // (?:^|[^a-zA-Z]) - Start of string or non-letter (to avoid matching in words)
  // (?<prefix>fixes|closes|resolves|refs)? - Optional action prefix
  // \s* - Optional whitespace
  // (?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))? - Optional owner/repo
  // #(?<number>\d+) - Required issue number
  // The pattern is case-insensitive
  const pattern = /(?:^|[^a-zA-Z])(?<prefix>fixes|closes|resolves|refs)?\s*(?:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+))?#(?<number>\d+)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const groups = match.groups;
    if (!groups) continue;

    const number = parseInt(groups.number, 10);
    if (isNaN(number) || number <= 0) continue;

    // Build the raw matched text (clean version without leading non-letter)
    let raw = '';
    if (groups.prefix) {
      raw += groups.prefix;
      raw += ' ';
    }
    if (groups.owner && groups.repo) {
      raw += `${groups.owner}/${groups.repo}`;
    }
    raw += `#${groups.number}`;

    refs.push({
      number,
      owner: groups.owner || undefined,
      repo: groups.repo || undefined,
      prefix: groups.prefix?.toLowerCase() as IssueRefPrefix | undefined,
      raw: raw.trim(),
    });
  }

  return refs;
}

/**
 * Extract issue references with categorization.
 *
 * @param text - Text to search
 * @returns Result with categorized references
 *
 * @example
 * ```typescript
 * extractIssueRefsWithContext('Fixes #123 and refs #456')
 * // Returns:
 * // {
 * //   refs: [...],
 * //   closingRefs: [{ number: 123, prefix: 'fixes', ... }],
 * //   mentionRefs: [{ number: 456, prefix: 'refs', ... }],
 * //   hasClosingRefs: true
 * // }
 * ```
 */
export function extractIssueRefsWithContext(text: string): IIssueRefResult {
  const refs = extractIssueRefs(text);

  const closingRefs = refs.filter(
    (ref) => ref.prefix && CLOSING_PREFIXES.includes(ref.prefix)
  );

  const mentionRefs = refs.filter(
    (ref) => !ref.prefix || ref.prefix === 'refs'
  );

  return {
    refs,
    closingRefs,
    mentionRefs,
    hasClosingRefs: closingRefs.length > 0,
  };
}

/**
 * Build a GitHub issue URL from a reference.
 *
 * @param ref - Issue reference
 * @param defaultOwner - Default owner if not in reference
 * @param defaultRepo - Default repo if not in reference
 * @returns Full GitHub issue URL
 *
 * @example
 * ```typescript
 * buildIssueUrl({ number: 123 }, 'myorg', 'myrepo')
 * // Returns: 'https://github.com/myorg/myrepo/issues/123'
 *
 * buildIssueUrl({ number: 456, owner: 'other', repo: 'project' })
 * // Returns: 'https://github.com/other/project/issues/456'
 * ```
 */
export function buildIssueUrl(
  ref: IIssueRef,
  defaultOwner?: string,
  defaultRepo?: string
): string {
  const owner = ref.owner || defaultOwner;
  const repo = ref.repo || defaultRepo;

  if (!owner || !repo) {
    throw new Error(
      `Cannot build issue URL: missing owner or repo for issue #${ref.number}`
    );
  }

  return `https://github.com/${owner}/${repo}/issues/${ref.number}`;
}

/**
 * Format issue references for display.
 *
 * @param refs - Issue references
 * @param defaultOwner - Default owner for same-repo references
 * @param defaultRepo - Default repo for same-repo references
 * @returns Formatted string like "#123, #456, owner/repo#789"
 */
export function formatIssueRefs(
  refs: IIssueRef[],
  defaultOwner?: string,
  defaultRepo?: string
): string {
  return refs
    .map((ref) => {
      if (ref.owner && ref.repo) {
        // Show full reference if it's cross-repo
        if (ref.owner !== defaultOwner || ref.repo !== defaultRepo) {
          return `${ref.owner}/${ref.repo}#${ref.number}`;
        }
      }
      return `#${ref.number}`;
    })
    .join(', ');
}

/**
 * Check if text contains any issue references.
 *
 * @param text - Text to check
 * @returns True if any issue references found
 */
export function hasIssueRefs(text: string): boolean {
  return extractIssueRefs(text).length > 0;
}

/**
 * Check if text contains closing issue references.
 *
 * @param text - Text to check
 * @returns True if any closing references (fixes, closes, resolves) found
 */
export function hasClosingRefs(text: string): boolean {
  return extractIssueRefsWithContext(text).hasClosingRefs;
}
