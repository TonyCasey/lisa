/**
 * IGitTriageService
 *
 * Domain interface for git history triage.
 * Scans local git history and scores commits for "interestingness"
 * to identify which commits warrant API enrichment.
 *
 * Part of the Git-Powered Memory feature (LISA-7).
 */

/**
 * Raw commit data extracted from git log.
 */
export interface IGitCommitData {
  /** Full commit SHA. */
  readonly sha: string;
  /** Short commit SHA. */
  readonly shortSha: string;
  /** Commit subject (first line of message). */
  readonly subject: string;
  /** Commit body (rest of message after subject). */
  readonly body: string;
  /** Number of parent commits (1 = normal, 2+ = merge). */
  readonly parentCount: number;
  /** Author name. */
  readonly author: string;
  /** Author email. */
  readonly authorEmail: string;
  /** Commit timestamp. */
  readonly timestamp: Date;
  /** Ref names pointing to this commit (tags, branches). */
  readonly refs: readonly string[];
}

/**
 * Diff statistics for a commit.
 */
export interface IGitCommitStats {
  /** Number of files changed. */
  readonly filesChanged: number;
  /** Number of lines added. */
  readonly insertions: number;
  /** Number of lines deleted. */
  readonly deletions: number;
  /** List of file paths that were added (new files). */
  readonly filesAdded: readonly string[];
  /** List of file paths that were deleted. */
  readonly filesDeleted: readonly string[];
  /** List of directories created (first appearance). */
  readonly directoriesCreated: readonly string[];
}

/**
 * Interest signals detected for a commit.
 */
export interface ICommitInterestSignals {
  /** Large diff: 10+ files changed. */
  readonly largeDiffFiles: boolean;
  /** Large diff: 500+ lines changed. */
  readonly largeDiffLines: boolean;
  /** Merge commit with PR reference. */
  readonly mergeCommitWithPR: boolean;
  /** Has conventional commit prefix (feat:, fix:, refactor:, etc.). */
  readonly hasConventionalPrefix: boolean;
  /** Conventional commit type if detected. */
  readonly conventionalType: string | null;
  /** Contains decision keywords (migrate, replace, rewrite, etc.). */
  readonly hasDecisionKeywords: boolean;
  /** Creates new top-level directory. */
  readonly createsNewDirectory: boolean;
  /** Within N commits of a version tag. */
  readonly isTagAdjacent: boolean;
  /** Has multi-line commit body. */
  readonly hasLongMessageBody: boolean;
  /** Extracted PR number from merge commit message. */
  readonly prNumber: number | null;
}

/**
 * A scored commit ready for triage decision.
 */
export interface IScoredCommit {
  /** The commit data. */
  readonly commit: IGitCommitData;
  /** Diff statistics (may be null if not fetched). */
  readonly stats: IGitCommitStats | null;
  /** Interest signals detected. */
  readonly signals: ICommitInterestSignals;
  /** Calculated interest score. */
  readonly score: number;
  /** Whether this commit passed the triage threshold. */
  readonly passedTriage: boolean;
}

/**
 * Result of a triage scan.
 */
export interface ITriageResult {
  /** Total commits scanned. */
  readonly totalCommits: number;
  /** Commits below threshold (skipped). */
  readonly belowThreshold: number;
  /** Commits with minor interest (extracted from message only). */
  readonly minorInterest: number;
  /** High-interest commits queued for API enrichment. */
  readonly highInterest: readonly IScoredCommit[];
  /** Commits linked to PRs (subset of highInterest). */
  readonly linkedToPRs: number;
  /** Commits linked to tags/releases. */
  readonly linkedToTags: number;
  /** Hotspot files (most frequently changed). */
  readonly hotspots: readonly IFileHotspot[];
  /** Tags found in the scanned range. */
  readonly tags: readonly ITagInfo[];
  /** Scan duration in milliseconds. */
  readonly durationMs: number;
}

/**
 * File hotspot information.
 */
export interface IFileHotspot {
  /** File path. */
  readonly path: string;
  /** Number of commits touching this file. */
  readonly commitCount: number;
  /** Total lines changed across all commits. */
  readonly totalLinesChanged: number;
}

/**
 * Tag information.
 */
export interface ITagInfo {
  /** Tag name. */
  readonly name: string;
  /** Commit SHA the tag points to. */
  readonly sha: string;
  /** Whether this looks like a version tag (v1.0.0, 1.0.0, etc.). */
  readonly isVersionTag: boolean;
}

/**
 * Options for triage scan.
 */
export interface ITriageOptions {
  /** Start date for scan (default: 3 months ago). */
  readonly since?: Date;
  /** End date for scan (default: now). */
  readonly until?: Date;
  /** Score threshold for high interest (default: 3). */
  readonly threshold?: number;
  /** Maximum commits to scan (default: unlimited). */
  readonly maxCommits?: number;
  /** Working directory (default: current). */
  readonly cwd?: string;
  /** Whether to fetch stats for all commits (slower) or only high-interest. */
  readonly fetchAllStats?: boolean;
}

/**
 * Git triage service interface.
 *
 * Scans git history to identify commits worth investigating via API.
 */
export interface IGitTriageService {
  /**
   * Perform a triage scan of git history.
   * @param options - Scan options.
   * @returns Triage results with scored commits.
   */
  triage(options?: ITriageOptions): Promise<ITriageResult>;

  /**
   * Score a single commit.
   *
   * Note: For tag-adjacency, the caller should pre-compute whether the commit
   * is within N commits of a tag (using positional analysis). If `isTagAdjacent`
   * is not provided, this method falls back to checking if the commit itself
   * is a tagged commit (SHA in tagShas), which is a weaker signal.
   *
   * @param commit - Commit data.
   * @param stats - Optional diff stats.
   * @param tagShas - Set of SHAs that have tags (used for fallback if isTagAdjacent not provided).
   * @param isTagAdjacent - Pre-computed tag adjacency (recommended for accurate scoring).
   * @returns Scored commit with signals.
   */
  scoreCommit(
    commit: IGitCommitData,
    stats: IGitCommitStats | null,
    tagShas: ReadonlySet<string>,
    isTagAdjacent?: boolean
  ): IScoredCommit;
}
