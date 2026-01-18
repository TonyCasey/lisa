/**
 * Summary Builder - Build summaries for Graphiti storage
 *
 * Provides functions for building formatted summaries of work
 * for storage in Graphiti memory system.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Work summary from transcript parsing
 */
export interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

/**
 * Complexity rating from rater
 */
export interface IComplexityRating {
  rating: 1 | 2 | 3 | 4 | 5;
  rawScore: number;
  signals: string[];
  summary: string;
}

/**
 * Options for building summary
 */
export interface ISummaryOptions {
  /** Maximum number of files to list */
  maxFiles?: number;
  /** Include tools used */
  includeTools?: boolean;
  /** Include signals */
  includeSignals?: boolean;
}

// =============================================================================
// Summary Building
// =============================================================================

/**
 * Build a Graphiti-formatted summary of work
 *
 * @param work - Work summary from transcript
 * @param rating - Complexity rating
 * @param repo - Repository name
 * @param branch - Branch name
 * @param sessionId - Session identifier
 * @param formatDuration - Duration formatter function
 * @param options - Summary building options
 * @returns Formatted summary string
 */
export function buildGraphitiSummary(
  work: IWorkSummary,
  rating: IComplexityRating,
  repo: string,
  branch: string | null,
  sessionId: string,
  formatDuration: (ms: number) => string,
  options: ISummaryOptions = {}
): string {
  const { maxFiles = 10, includeTools = true, includeSignals = true } = options;

  const lines: string[] = [];

  // Header with complexity rating
  lines.push(`MILESTONE [complexity:${rating.rating}]: ${rating.summary}`);
  lines.push('');

  // Session info
  lines.push(`Session: ${sessionId}`);
  if (repo) {
    lines.push(`Repository: ${repo}${branch ? ` (${branch})` : ''}`);
  }
  lines.push(`Duration: ${formatDuration(work.durationMs)}`);
  lines.push(`Timestamp: ${work.timestamp}`);
  lines.push('');

  // Work summary counts
  lines.push(`Files modified: ${work.filesModified.size}`);
  lines.push(`Files created: ${work.filesCreated.size}`);
  if (work.commandsRun.length > 0) {
    lines.push(`Commands run: ${work.commandsRun.length}`);
  }
  lines.push('');

  // Key changes (file list)
  if (work.filesCreated.size > 0 || work.filesModified.size > 0) {
    lines.push('Key changes:');
    const allFiles = [...work.filesCreated].map((f) => `- Created ${f}`);
    allFiles.push(...[...work.filesModified].map((f) => `- Modified ${f}`));

    // Limit to maxFiles
    lines.push(...allFiles.slice(0, maxFiles));
    if (allFiles.length > maxFiles) {
      lines.push(`- ... and ${allFiles.length - maxFiles} more`);
    }
    lines.push('');
  }

  // Tools used
  if (includeTools && work.toolsUsed.size > 0) {
    const toolsSummary = Array.from(work.toolsUsed.entries())
      .map(([tool, count]) => `${tool} (${count}x)`)
      .join(', ');
    lines.push(`Tools used: ${toolsSummary}`);
    lines.push('');
  }

  // Complexity signals
  if (includeSignals && rating.signals.length > 0) {
    lines.push(`Signals: ${rating.signals.join(', ')}`);
    lines.push('');
  }

  // Assistant summary (truncated)
  if (work.assistantSummary) {
    lines.push('Summary:');
    lines.push(work.assistantSummary);
  }

  return lines.join('\n');
}

/**
 * Build tags for Graphiti storage
 *
 * @param rating - Complexity rating
 * @param sessionId - Session identifier
 * @param repo - Repository name (optional)
 * @param branch - Branch name (optional)
 * @returns Array of tag strings
 */
export function buildGraphitiTags(
  rating: IComplexityRating,
  sessionId: string,
  repo?: string,
  branch?: string | null
): string[] {
  const tags = [
    'automated',
    `complexity:${rating.rating}`,
    'milestone',
    `session:${sessionId}`,
  ];

  if (repo) {
    tags.push(`repo:${repo}`);
  }
  if (branch) {
    tags.push(`branch:${branch}`);
  }

  return tags;
}

/**
 * Build tags for retrospective storage
 *
 * @param sessionId - Session identifier
 * @param repo - Repository name (optional)
 * @returns Array of tag strings
 */
export function buildRetrospectiveTags(
  sessionId: string,
  repo?: string
): string[] {
  const tags = ['retrospective', 'automated', `session:${sessionId}`];

  if (repo) {
    tags.push(`repo:${repo}`);
  }

  return tags;
}

/**
 * Check if work is significant enough to save to Graphiti
 *
 * @param rating - Complexity rating
 * @param threshold - Minimum rating to save (default: 3)
 * @returns True if work should be saved to Graphiti
 */
export function shouldSaveToGraphiti(
  rating: IComplexityRating,
  threshold: number = 3
): boolean {
  return rating.rating >= threshold;
}

/**
 * Check if work has any meaningful changes
 *
 * @param work - Work summary
 * @returns True if work has files or commands
 */
export function hasSignificantWork(work: IWorkSummary): boolean {
  return (
    work.filesModified.size > 0 ||
    work.filesCreated.size > 0 ||
    work.commandsRun.length > 0
  );
}
