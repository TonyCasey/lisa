/**
 * IRepoProfileService
 *
 * Domain interface for generating and maintaining a living repo profile
 * markdown document at `.lisa/data/repo-profile.md`.
 *
 * Consumes pipeline data from Phase 1 (triage) and Phase 3 (extraction)
 * plus init-review codebase summary to produce a structured profile
 * that gives every session instant understanding of the project.
 *
 * Part of LISA-11: Repo Profile Generation.
 */

import type { ITriageResult, IGitCommitData } from './IGitTriageService';
import type { IHeuristicExtractionResult } from './IGitExtractor';

/**
 * Freshness state of the repo profile.
 *
 * - fresh: updated within 24h
 * - stale: 1-7 days old
 * - expired: older than 7 days
 * - missing: file does not exist
 */
export type ProfileFreshness = 'fresh' | 'stale' | 'expired' | 'missing';

/**
 * All valid profile freshness values.
 */
export const PROFILE_FRESHNESS_VALUES: readonly ProfileFreshness[] = [
  'fresh',
  'stale',
  'expired',
  'missing',
] as const;

/**
 * Result of checking profile freshness.
 */
export interface IProfileFreshnessResult {
  /** Current freshness state. */
  readonly freshness: ProfileFreshness;
  /** When the profile was last updated (null if missing). */
  readonly lastUpdated: Date | null;
  /** Age in hours (null if missing). */
  readonly ageHours: number | null;
  /** Human-readable note about freshness. */
  readonly note: string;
}

/**
 * Input data for generating a repo profile.
 * Aggregates data from the git pipeline phases.
 */
export interface IProfileInput {
  /** Project name (e.g. from package.json or directory name). */
  readonly projectName: string;
  /** Project root path. */
  readonly projectRoot: string;
  /** Triage result from Phase 1 (optional - may not have run). */
  readonly triage?: ITriageResult;
  /** Heuristic extraction result from Phase 3 (optional). */
  readonly extraction?: IHeuristicExtractionResult;
  /** Init-review codebase summary (optional). */
  readonly codebaseSummary?: string;
  /** Recent git commits for the "Recent Activity" section. */
  readonly recentCommits?: readonly IGitCommitData[];
  /** Timestamp when profile generation was initiated. */
  readonly generatedAt: Date;
}

/**
 * Result of profile generation.
 */
export interface IProfileGenerateResult {
  /** The generated markdown content. */
  readonly markdown: string;
  /** Path where the profile was written. */
  readonly filePath: string;
  /** Number of sections that had data populated. */
  readonly sectionsPopulated: number;
  /** Total number of sections in the template. */
  readonly totalSections: number;
}

/**
 * Result of reading an existing profile.
 */
export interface IProfileReadResult {
  /** The markdown content (null if file is missing). */
  readonly markdown: string | null;
  /** Freshness information. */
  readonly freshness: IProfileFreshnessResult;
  /** Path where the profile would/does live. */
  readonly filePath: string;
}

/**
 * Options for profile generation.
 */
export interface IProfileGenerateOptions {
  /** Maximum hotspots to include. Default: 10. */
  readonly maxHotspots?: number;
  /** Maximum facts per section (decisions, gotchas, conventions). Default: 10. */
  readonly maxFactsPerSection?: number;
  /** Maximum recent commits to include. Default: 10. */
  readonly maxRecentCommits?: number;
}

/**
 * Service for generating and maintaining the repo profile markdown document.
 */
export interface IRepoProfileService {
  /**
   * Generate a full repo profile from pipeline data.
   * Writes the markdown file to `.lisa/data/repo-profile.md`.
   *
   * @param input - Aggregated pipeline data
   * @param options - Generation options
   * @returns Generation result with markdown content and stats
   */
  generate(
    input: IProfileInput,
    options?: IProfileGenerateOptions
  ): Promise<IProfileGenerateResult>;

  /**
   * Read the existing repo profile, if present.
   * Returns content and freshness information.
   *
   * @param projectRoot - Project root directory
   * @returns Read result with content and freshness
   */
  read(projectRoot: string): Promise<IProfileReadResult>;

  /**
   * Check the freshness of the existing repo profile.
   * Lightweight metadata check without reading full content.
   *
   * Freshness rules:
   * - fresh: updated within 24h
   * - stale: 1-7 days old
   * - expired: older than 7 days
   * - missing: file does not exist
   *
   * @param projectRoot - Project root directory
   * @returns Freshness result
   */
  checkFreshness(projectRoot: string): Promise<IProfileFreshnessResult>;
}
