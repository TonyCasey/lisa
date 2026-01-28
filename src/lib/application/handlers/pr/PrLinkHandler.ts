/**
 * PR Link Handler
 *
 * Links a PR to an issue, creating a CLOSES relationship in Neo4j
 * and optionally commenting on the GitHub issue.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';

/**
 * Options for PR link operation.
 */
export interface IPrLinkOptions {
  /** Repository in owner/repo format. Uses current repo if not provided. */
  readonly repo?: string;
  /** PR number to link. */
  readonly prNumber: number;
  /** Issue number to link to. */
  readonly issueNumber: number;
  /** Skip commenting on the GitHub issue. */
  readonly noComment?: boolean;
}

/**
 * PR info in link result.
 */
export interface IPrLinkPrInfo {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly url: string;
}

/**
 * Issue info in link result.
 */
export interface IPrLinkIssueInfo {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly url: string;
}

/**
 * Result from PrLinkHandler.
 */
export interface IPrLinkResult {
  readonly success: boolean;
  readonly message: string;
  /** PR details if successful. */
  readonly pr?: IPrLinkPrInfo;
  /** Issue details if successful. */
  readonly issue?: IPrLinkIssueInfo;
  /** True if the PR was already linked to this issue. */
  readonly alreadyLinked: boolean;
}

/**
 * Handler for linking PRs to issues.
 */
export class PrLinkHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Link a PR to an issue.
   *
   * Creates a CLOSES relationship in Neo4j and optionally comments
   * on the GitHub issue. Idempotent - linking an already-linked
   * PR/issue pair returns success with alreadyLinked=true.
   */
  async execute(options: IPrLinkOptions): Promise<IPrLinkResult> {
    const { prNumber, issueNumber, noComment } = options;

    try {
      // 1. Resolve repository
      const repo = options.repo || await this.githubClient.getCurrentRepo();

      // 2. Validate PR exists on GitHub
      const ghPr = await this.githubClient.getPr(repo, prNumber);
      if (!ghPr) {
        return {
          success: false,
          message: `PR #${prNumber} not found in repository ${repo}`,
          alreadyLinked: false,
        };
      }

      // 3. Validate Issue exists on GitHub
      const ghIssue = await this.githubClient.getIssue(repo, issueNumber);
      if (!ghIssue) {
        return {
          success: false,
          message: `Issue #${issueNumber} not found in repository ${repo}`,
          alreadyLinked: false,
        };
      }

      // 4. Get user ID for Neo4j scoping
      const userId = await this.prRepository.getUserId();

      // 5. Ensure PR node exists in Neo4j
      const existingPr = await this.prRepository.findPr(userId, repo, prNumber);
      if (!existingPr) {
        await this.prRepository.upsertPr(userId, {
          number: prNumber,
          repo,
          title: ghPr.title,
          status: this.mapPrStatus(ghPr.state),
          watching: false,
        });
      }

      // 6. Upsert Issue node in Neo4j
      await this.prRepository.upsertIssue(userId, {
        number: issueNumber,
        repo,
        title: ghIssue.title,
        url: ghIssue.url,
      });

      // 7. Check existing linked issues
      const existingIssues = await this.prRepository.findIssuesByPr(userId, repo, prNumber);
      const alreadyLinked = existingIssues.some(i => i.number === issueNumber);

      if (alreadyLinked) {
        return {
          success: true,
          message: `PR #${prNumber} is already linked to Issue #${issueNumber}`,
          pr: {
            number: prNumber,
            repo,
            title: ghPr.title,
            url: `https://github.com/${repo}/pull/${prNumber}`,
          },
          issue: {
            number: issueNumber,
            repo,
            title: ghIssue.title,
            url: ghIssue.url,
          },
          alreadyLinked: true,
        };
      }

      // 8. Link PR to issues (preserve existing + add new)
      const existingIssueNumbers = existingIssues.map(i => i.number);
      const allIssueNumbers = [...existingIssueNumbers, issueNumber];
      await this.prRepository.linkPrToIssues(userId, repo, prNumber, allIssueNumbers);

      // 9. Comment on GitHub issue (unless noComment)
      if (!noComment) {
        try {
          await this.githubClient.commentOnIssue(
            repo,
            issueNumber,
            `Linked to PR #${prNumber}`
          );
        } catch (commentError) {
          // Log but don't fail the operation if comment fails
          // The Neo4j link was successful
          console.warn(
            `Warning: Failed to comment on issue #${issueNumber}: ${
              commentError instanceof Error ? commentError.message : String(commentError)
            }`
          );
        }
      }

      // 10. Return success
      return {
        success: true,
        message: `Linked PR #${prNumber} to Issue #${issueNumber}`,
        pr: {
          number: prNumber,
          repo,
          title: ghPr.title,
          url: `https://github.com/${repo}/pull/${prNumber}`,
        },
        issue: {
          number: issueNumber,
          repo,
          title: ghIssue.title,
          url: ghIssue.url,
        },
        alreadyLinked: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to link PR #${prNumber} to Issue #${issueNumber}: ${message}`,
        alreadyLinked: false,
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
}
