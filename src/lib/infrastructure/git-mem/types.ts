/**
 * Git-mem CLI response types.
 *
 * These types match the JSON output from `git mem recall --json`
 * and `git mem context --json` commands.
 */

/**
 * Memory type in git-mem.
 * Maps to Lisa's type tags (e.g., type:decision → 'decision').
 */
export type GitMemType = 'decision' | 'gotcha' | 'convention' | 'fact';

/**
 * Confidence level in git-mem.
 */
export type GitMemConfidence = 'verified' | 'high' | 'medium' | 'low';

/**
 * Lifecycle tier in git-mem.
 */
export type GitMemLifecycle = 'permanent' | 'project' | 'session';

/**
 * A single memory entry from git-mem.
 * Matches the JSON output of `git mem recall --json`.
 */
export interface IGitMemEntry {
  readonly id: string;
  readonly content: string;
  readonly type: GitMemType;
  readonly sha: string;
  readonly confidence: GitMemConfidence;
  readonly source: string;
  readonly lifecycle: GitMemLifecycle;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Response from `git mem recall --json`.
 */
export interface IGitMemRecallResponse {
  readonly memories: readonly IGitMemEntry[];
}

/**
 * Response from `git mem context --json`.
 */
export interface IGitMemContextResponse {
  readonly memories: readonly IGitMemEntry[];
}

/**
 * Options for the remember command.
 */
export interface IRememberOptions {
  readonly type?: GitMemType;
  readonly lifecycle?: GitMemLifecycle;
  readonly confidence?: GitMemConfidence;
  readonly tags?: readonly string[];
  readonly commit?: string;
}

/**
 * Options for the recall command.
 */
export interface IRecallOptions {
  readonly limit?: number;
  readonly type?: GitMemType;
  readonly since?: string;
  readonly tag?: string;
}

/**
 * Options for the context command.
 */
export interface IContextOptions {
  readonly limit?: number;
  readonly threshold?: number;
}

/**
 * Options for the retrofit command.
 */
export interface IRetrofitOptions {
  readonly since?: string;
  readonly maxCommits?: number;
  readonly threshold?: number;
  readonly dryRun?: boolean;
}

/**
 * Result from the retrofit command.
 */
export interface IRetrofitResult {
  readonly success: boolean;
  readonly output: string;
}
