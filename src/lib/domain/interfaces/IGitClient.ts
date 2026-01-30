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
}
