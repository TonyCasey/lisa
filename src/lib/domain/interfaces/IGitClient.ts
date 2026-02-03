/**
 * IGitClient
 *
 * Domain interface for git CLI operations.
 * Application-layer code uses this interface instead of importing child_process.
 * Infrastructure provides the concrete implementation.
 */

/**
 * Options for git log operations.
 */
export interface IGitLogOptions {
  /** Only show commits after this date (YYYY-MM-DD). */
  readonly since?: string;
  /** Log output format string. */
  readonly format?: string;
  /** Maximum number of commits to return. */
  readonly maxCount?: number;
  /** Working directory for the git command. */
  readonly cwd?: string;
}

/**
 * Options for git diff operations.
 */
export interface IGitDiffOptions {
  /** Base ref to diff against. */
  readonly base: string;
  /** Head ref (defaults to HEAD). */
  readonly head?: string;
  /** Use three-dot diff syntax (base...head). */
  readonly threeDot?: boolean;
  /** Return only file names, not full diff. */
  readonly nameOnly?: boolean;
  /** Maximum stdout buffer size in bytes. */
  readonly maxBuffer?: number;
  /** Working directory for the git command. */
  readonly cwd?: string;
}

/**
 * Options for detailed git log operations (triage).
 */
export interface IGitLogDetailedOptions {
  /** Only show commits after this date (YYYY-MM-DD or ISO). */
  readonly since?: string;
  /** Only show commits before this date (YYYY-MM-DD or ISO). */
  readonly until?: string;
  /** Maximum number of commits to return. */
  readonly maxCount?: number;
  /** Working directory for the git command. */
  readonly cwd?: string;
}

/**
 * Parsed commit from detailed log.
 */
export interface IGitLogCommit {
  /** Full SHA. */
  readonly sha: string;
  /** Short SHA. */
  readonly shortSha: string;
  /** Parent SHAs (space-separated in raw form). */
  readonly parentShas: readonly string[];
  /** Commit subject. */
  readonly subject: string;
  /** Commit body (may be empty). */
  readonly body: string;
  /** Author name. */
  readonly authorName: string;
  /** Author email. */
  readonly authorEmail: string;
  /** Author timestamp (Unix epoch). */
  readonly authorTimestamp: number;
  /** Ref names (tags, branches) if any. */
  readonly refNames: string;
}

/**
 * Commit stat entry from --numstat.
 */
export interface IGitCommitStatEntry {
  /** Lines added (may be '-' for binary). */
  readonly added: number | null;
  /** Lines deleted (may be '-' for binary). */
  readonly deleted: number | null;
  /** File path. */
  readonly path: string;
  /** Whether file was added (new). */
  readonly isNew: boolean;
  /** Whether file was deleted. */
  readonly isDeleted: boolean;
}

/**
 * Tag information from git.
 */
export interface IGitTag {
  /** Tag name. */
  readonly name: string;
  /** Commit SHA the tag points to. */
  readonly sha: string;
}

/**
 * Git client interface for shell-free application layer code.
 */
export interface IGitClient {
  /**
   * Get recent commit log output.
   * @returns Raw git log output string.
   */
  log(options: IGitLogOptions): string;

  /**
   * Get the URL of a named remote.
   * @param remote - Remote name (e.g. 'origin').
   * @param cwd - Working directory.
   * @returns The remote URL string.
   */
  getRemoteUrl(remote: string, cwd?: string): string;

  /**
   * Detect the default branch name (main or master).
   * @param cwd - Working directory.
   * @returns The default branch name.
   */
  getDefaultBranch(cwd?: string): string;

  /**
   * Get diff between refs.
   * @returns Raw diff output string.
   */
  diff(options: IGitDiffOptions): string;

  /**
   * Check whether a git ref exists.
   * @param ref - The ref to verify (e.g. 'main').
   * @param cwd - Working directory.
   * @returns True if the ref exists.
   */
  refExists(ref: string, cwd?: string): boolean;

  /**
   * Get detailed commit log for triage analysis.
   * Returns structured commit data including parents, body, refs.
   * @param options - Log options.
   * @returns Array of parsed commits.
   */
  logDetailed(options: IGitLogDetailedOptions): IGitLogCommit[];

  /**
   * Get file statistics for a specific commit.
   * @param sha - Commit SHA.
   * @param cwd - Working directory.
   * @returns Array of stat entries per file.
   */
  getCommitStats(sha: string, cwd?: string): IGitCommitStatEntry[];

  /**
   * List all tags in the repository.
   * @param cwd - Working directory.
   * @returns Array of tag info.
   */
  listTags(cwd?: string): IGitTag[];

  /**
   * Get the total number of commits in the repository.
   * @param cwd - Working directory.
   * @returns Total commit count.
   */
  countCommits(cwd?: string): number;
}
