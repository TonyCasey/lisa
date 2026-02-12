/**
 * PR Remember Handler
 *
 * Saves notes about PRs to memory with appropriate tags.
 * Enables learning capture from PR reviews.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IMemoryWriter } from '../../../domain/interfaces/IMemoryService';

/**
 * Options for PR remember operation.
 */
export interface IPrRememberOptions {
  /** Repository in owner/repo format. Uses current repo if not provided. */
  readonly repo?: string;
  /** PR number. */
  readonly prNumber: number;
  /** Note to save about the PR. */
  readonly note: string;
}

/**
 * Result from PrRememberHandler.
 */
export interface IPrRememberResult {
  readonly success: boolean;
  readonly message: string;
  /** PR details. */
  readonly pr?: {
    readonly number: number;
    readonly repo: string;
    readonly title: string;
  };
  /** Fact that was saved. */
  readonly fact?: string;
  /** Tags applied to the fact. */
  readonly tags?: readonly string[];
}

/**
 * Handler for saving PR notes to memory.
 */
export class PrRememberHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly memoryService: IMemoryWriter
  ) {}

  /**
   * Save a note about a PR to memory.
   *
   * Fetches PR details from GitHub and saves the note with
   * github:pr and github:pr:<number> tags.
   */
  async execute(options: IPrRememberOptions): Promise<IPrRememberResult> {
    const { prNumber, note } = options;

    try {
      // 1. Resolve repository
      const repo = options.repo || await this.githubClient.getCurrentRepo();
      if (!repo) {
        return {
          success: false,
          message: 'Could not determine repository. Specify --repo or run from a git repository.',
        };
      }

      // 2. Fetch PR details from GitHub
      const ghPr = await this.githubClient.getPr(repo, prNumber);
      if (!ghPr) {
        return {
          success: false,
          message: `PR #${prNumber} not found in repository ${repo}`,
        };
      }

      // 3. Build the fact
      const fact = `PR #${prNumber} (${ghPr.title}): ${note}`;

      // 4. Build tags
      const tags = ['github:pr', `github:pr:${prNumber}`];

      // 5. Save to memory
      await this.memoryService.addFact(fact, tags);

      // 6. Return success
      return {
        success: true,
        message: `Saved note for PR #${prNumber}`,
        pr: {
          number: prNumber,
          repo,
          title: ghPr.title,
        },
        fact,
        tags,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to save PR note: ${message}`,
      };
    }
  }
}
