/**
 * Prompt service interface for skill scripts.
 * Captures user prompts to git-mem with deduplication.
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */

/**
 * Arguments for adding a prompt.
 */
export interface IPromptArgs {
  text: string;
  role?: string;
  source?: string;
  force?: boolean;
}

/**
 * Result of a prompt add operation.
 */
export interface IPromptResult {
  status: 'ok' | 'skipped';
  action?: 'add';
  group?: string;
  role?: string;
  source?: string;
  reason?: string;
}

/**
 * Prompt service interface.
 */
export interface ISkillPromptService {
  /**
   * Generate a fingerprint for deduplication.
   *
   * @param text - The prompt text to fingerprint
   * @returns SHA1-based fingerprint (first 16 chars)
   */
  fingerprint(text: string): string;

  /**
   * Add a prompt to memory.
   *
   * @param args - Prompt arguments
   * @returns Result indicating success or skip (duplicate)
   */
  addPrompt(args: IPromptArgs): Promise<IPromptResult>;
}
