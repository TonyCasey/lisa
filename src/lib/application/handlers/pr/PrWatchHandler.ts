/**
 * PR Watch Handler
 *
 * Manages PR watch list - watch, unwatch, and list watched PRs.
 * Stores watching state in Neo4j for persistence across sessions.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { IPullRequest, CheckStatus } from '../../../domain/interfaces/types/IPullRequest';
import { createPullRequest } from '../../../domain/interfaces/types/IPullRequest';

/**
 * Watched PR with summary info.
 */
export interface IWatchedPr {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly status: 'open' | 'merged' | 'closed';
  readonly checksStatus: CheckStatus;
  readonly unresolvedComments: number;
  readonly watchingSince: string;
  readonly lastPolled?: string;
}

/**
 * Result from PrWatchHandler.
 */
export interface IPrWatchResult {
  readonly action: 'watch' | 'unwatch' | 'list';
  readonly success: boolean;
  readonly message: string;
  readonly watchedPrs?: readonly IWatchedPr[];
  readonly pr?: IWatchedPr;
}

/**
 * Options for watch command.
 */
export interface IPrWatchOptions {
  readonly repo?: string;
  readonly prNumber: number;
}

/**
 * Options for list command.
 */
export interface IPrWatchingOptions {
  readonly repo?: string;  // Filter by repo
  readonly limit?: number;
}

/**
 * Handler for PR watch operations.
 */
export class PrWatchHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Start watching a PR.
   */
  async watch(options: IPrWatchOptions): Promise<IPrWatchResult> {
    const repo = options.repo || await this.githubClient.getCurrentRepo();

    try {
      // Fetch PR details from GitHub
      const ghPr = await this.githubClient.getPr(repo, options.prNumber);

      // Get user ID
      const userId = await this.prRepository.getUserId();

      // Create/update PR in Neo4j with watching=true
      const pr = createPullRequest({
        number: options.prNumber,
        repo,
        title: ghPr.title,
        status: this.mapPrStatus(ghPr.state),
        watching: true,
      });

      await this.prRepository.upsertPr(userId, {
        number: pr.number,
        repo: pr.repo,
        title: pr.title,
        status: pr.status,
        watching: true,
      });

      // Also link any closing issues
      if (ghPr.closingIssuesReferences && ghPr.closingIssuesReferences.length > 0) {
        const issueNumbers = ghPr.closingIssuesReferences.map(i => i.number);
        await this.prRepository.linkPrToIssues(userId, repo, options.prNumber, issueNumbers);

        // Upsert the issues too
        for (const issue of ghPr.closingIssuesReferences) {
          await this.prRepository.upsertIssue(userId, {
            number: issue.number,
            repo,
            title: issue.title,
            url: issue.url,
          });
        }
      }

      return {
        action: 'watch',
        success: true,
        message: `Now watching PR #${options.prNumber}: ${ghPr.title}`,
        pr: {
          number: options.prNumber,
          repo,
          title: ghPr.title,
          status: pr.status,
          checksStatus: 'pending',
          unresolvedComments: 0,
          watchingSince: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        action: 'watch',
        success: false,
        message: `Failed to watch PR #${options.prNumber}: ${message}`,
      };
    }
  }

  /**
   * Stop watching a PR.
   */
  async unwatch(options: IPrWatchOptions): Promise<IPrWatchResult> {
    const repo = options.repo || await this.githubClient.getCurrentRepo();

    try {
      const userId = await this.prRepository.getUserId();

      // Update watching status
      await this.prRepository.setWatching(userId, repo, options.prNumber, false);

      return {
        action: 'unwatch',
        success: true,
        message: `Stopped watching PR #${options.prNumber}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        action: 'unwatch',
        success: false,
        message: `Failed to unwatch PR #${options.prNumber}: ${message}`,
      };
    }
  }

  /**
   * List all watched PRs.
   */
  async list(options?: IPrWatchingOptions): Promise<IPrWatchResult> {
    try {
      const userId = await this.prRepository.getUserId();

      const result = await this.prRepository.findWatchedPrs(userId, {
        repo: options?.repo,
        limit: options?.limit || 20,
      });

      const watchedPrs = result.items.map(pr => this.toWatchedPr(pr));

      if (watchedPrs.length === 0) {
        return {
          action: 'list',
          success: true,
          message: 'No PRs being watched',
          watchedPrs: [],
        };
      }

      return {
        action: 'list',
        success: true,
        message: `Watching ${watchedPrs.length} PR(s)`,
        watchedPrs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        action: 'list',
        success: false,
        message: `Failed to list watched PRs: ${message}`,
      };
    }
  }

  /**
   * Map GitHub PR state to domain status.
   */
  private mapPrStatus(state: 'OPEN' | 'CLOSED' | 'MERGED'): 'open' | 'merged' | 'closed' {
    switch (state) {
      case 'MERGED':
        return 'merged';
      case 'CLOSED':
        return 'closed';
      case 'OPEN':
      default:
        return 'open';
    }
  }

  /**
   * Convert domain IPullRequest to IWatchedPr.
   */
  private toWatchedPr(pr: IPullRequest): IWatchedPr {
    return {
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      status: pr.status,
      checksStatus: pr.checksStatus,
      unresolvedComments: pr.unresolvedComments,
      watchingSince: pr.watchingSince || pr.created_at || new Date().toISOString(),
      lastPolled: pr.lastPolled,
    };
  }
}
