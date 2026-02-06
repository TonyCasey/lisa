/**
 * Git-mem Client Interface
 *
 * Contract for interacting with the git-mem CLI.
 * Lives in the domain layer — implementations in infrastructure.
 */

import type {
  IGitMemEntry,
  IRememberOptions,
  IRecallOptions,
  IContextOptions,
  IRetrofitOptions,
  IRetrofitResult,
} from '../../infrastructure/git-mem/types';

/**
 * Client for git-mem CLI operations.
 *
 * All methods handle errors gracefully:
 * - remember: returns false on failure
 * - recall/context: return empty arrays on failure
 * - retrofit: returns { success: false } on failure
 */
export interface IGitMemClient {
  /**
   * Store a memory in git-mem.
   * @param text - The memory content to store
   * @param options - Type, lifecycle, confidence, tags, commit
   * @returns true if stored successfully, false on error
   */
  remember(text: string, options?: IRememberOptions): Promise<boolean>;

  /**
   * Search and retrieve memories.
   * @param query - Optional search text (empty returns all)
   * @param options - Limit, type filter, since date, tag filter
   * @returns Array of memory entries (empty on error)
   */
  recall(query?: string, options?: IRecallOptions): Promise<readonly IGitMemEntry[]>;

  /**
   * Get memories relevant to currently staged git changes.
   * @param options - Limit and relevance threshold
   * @returns Array of relevant memory entries (empty on error)
   */
  context(options?: IContextOptions): Promise<readonly IGitMemEntry[]>;

  /**
   * Scan commit history and extract memories.
   * @param options - Since date, max commits, threshold, dry run
   * @returns Result with success status and output
   */
  retrofit(options?: IRetrofitOptions): Promise<IRetrofitResult>;
}
