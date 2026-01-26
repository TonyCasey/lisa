/**
 * PR Create Handler
 *
 * Creates a PR with auto-generated body, issue linking, and auto-watch.
 * Supports branch name parsing for issue detection.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { IGhPrResponse } from '../../../infrastructure/github/types';

/**
 * Options for PR creation.
 */
export interface IPrCreateOptions {
  /** Issue number(s) to link. If not provided, attempts to parse from branch name. */
  readonly issues?: number[];
  /** Target branch. If not provided, uses default branch (main/master). */
  readonly base?: string;
  /** Source branch. If not provided, uses current branch. */
  readonly head?: string;
  /** PR title. If not provided, uses issue title or generates from commits. */
  readonly title?: string;
  /** Create as draft PR. */
  readonly draft?: boolean;
  /** Skip auto-watch after creation. */
  readonly noWatch?: boolean;
  /** Skip commenting on linked issues. */
  readonly noComment?: boolean;
}

/**
 * Result from PR creation.
 */
export interface IPrCreateResult {
  readonly success: boolean;
  readonly message: string;
  readonly pr?: {
    readonly number: number;
    readonly url: string;
    readonly title: string;
    readonly repo: string;
  };
  readonly linkedIssues?: readonly number[];
  readonly body?: string;
}

/**
 * Handler for creating PRs with auto-generated content.
 */
export class PrCreateHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Create a PR with auto-generated body and issue linking.
   */
  async execute(options: IPrCreateOptions = {}): Promise<IPrCreateResult> {
    try {
      // 1. Get repo and branch info
      const repo = await this.githubClient.getCurrentRepo();
      const currentBranch = options.head || await this.githubClient.getCurrentBranch();
      const baseBranch = options.base || await this.githubClient.getDefaultBranch(repo);

      // 2. Parse issue numbers from branch name if not provided
      const issues = options.issues || this.parseIssuesFromBranch(currentBranch);

      // 3. Get issue details for title and linking
      let title = options.title;
      const issueDetails: Array<{ number: number; title: string }> = [];

      for (const issueNumber of issues) {
        try {
          const issue = await this.githubClient.getIssue(repo, issueNumber);
          issueDetails.push({ number: issue.number, title: issue.title });
          // Use first linked issue's title if no title provided
          if (!title) {
            title = issue.title;
          }
        } catch {
          // Issue doesn't exist, skip
        }
      }

      // 4. Generate title from commits if still not set
      if (!title) {
        const commits = await this.githubClient.getCommitMessages(`origin/${baseBranch}`, currentBranch);
        title = commits[0] || `Changes from ${currentBranch}`;
      }

      // 5. Generate PR body
      const body = await this.generatePrBody(repo, baseBranch, currentBranch, issueDetails);

      // 6. Create the PR
      const pr = await this.githubClient.createPr({
        repo,
        title,
        body,
        base: baseBranch,
        head: currentBranch,
        draft: options.draft,
      });

      // 7. Comment on linked issues
      if (!options.noComment && issueDetails.length > 0) {
        await this.commentOnLinkedIssues(repo, pr.number, issueDetails);
      }

      // 8. Auto-watch the PR (also upserts PR node for relationship linking)
      if (!options.noWatch) {
        await this.watchPr(repo, pr);
      }

      // 9. Create Neo4j relationships (requires PR node to exist)
      // Only create relationships if watching is enabled (PR node exists)
      if (!options.noWatch && issueDetails.length > 0) {
        await this.createNeo4jRelationships(repo, pr, issueDetails);
      }

      return {
        success: true,
        message: `Created PR #${pr.number}: ${pr.url}`,
        pr: {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          repo,
        },
        linkedIssues: issueDetails.map(i => i.number),
        body,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create PR: ${message}`,
      };
    }
  }

  /**
   * Parse issue numbers from branch name.
   * Supports formats: "15", "15-description", "feature/15", "feature/15-description"
   */
  private parseIssuesFromBranch(branch: string): number[] {
    const issues: number[] = [];

    // Try to extract issue number from common patterns
    // Pattern 1: Just the number "15"
    if (/^\d+$/.test(branch)) {
      issues.push(parseInt(branch, 10));
      return issues;
    }

    // Pattern 2: Number at start "15-description"
    const startMatch = branch.match(/^(\d+)[-_]/);
    if (startMatch) {
      issues.push(parseInt(startMatch[1], 10));
      return issues;
    }

    // Pattern 3: After slash "feature/15" or "feature/15-description"
    const slashMatch = branch.match(/\/(\d+)(?:[-_]|$)/);
    if (slashMatch) {
      issues.push(parseInt(slashMatch[1], 10));
      return issues;
    }

    // Pattern 4: Issue references in branch name "#15" or "issue-15"
    const hashMatch = branch.match(/#(\d+)/g);
    if (hashMatch) {
      for (const match of hashMatch) {
        issues.push(parseInt(match.slice(1), 10));
      }
      return issues;
    }

    const issueMatch = branch.match(/issue[-_]?(\d+)/i);
    if (issueMatch) {
      issues.push(parseInt(issueMatch[1], 10));
    }

    return issues;
  }

  /**
   * Generate PR body with summary, test coverage, and linked issues.
   */
  private async generatePrBody(
    repo: string,
    baseBranch: string,
    headBranch: string,
    issues: Array<{ number: number; title: string }>
  ): Promise<string> {
    const sections: string[] = [];

    // Summary section from commits
    const commits = await this.githubClient.getCommitMessages(`origin/${baseBranch}`, headBranch);
    if (commits.length > 0) {
      sections.push('## Summary');
      for (const commit of commits.slice(0, 10)) { // Limit to 10 commits
        sections.push(`- ${commit}`);
      }
      if (commits.length > 10) {
        sections.push(`- ... and ${commits.length - 10} more commits`);
      }
      sections.push('');
    }

    // Test coverage section
    const changedFiles = await this.githubClient.getChangedFiles(`origin/${baseBranch}`, headBranch);
    const testFiles = changedFiles.filter(f => 
      f.includes('.test.') || 
      f.includes('.spec.') || 
      f.includes('__tests__') ||
      f.startsWith('tests/')
    );
    
    if (testFiles.length > 0) {
      sections.push('## Test Coverage');
      for (const file of testFiles) {
        sections.push(`- \`${file}\``);
      }
      sections.push('');
    }

    // Linked issues section
    if (issues.length > 0) {
      sections.push('## Linked Issues');
      for (const issue of issues) {
        sections.push(`Closes #${issue.number}`);
      }
      sections.push('');
    }

    return sections.join('\n').trim();
  }

  /**
   * Comment on linked issues with PR reference.
   */
  private async commentOnLinkedIssues(
    repo: string,
    prNumber: number,
    issues: Array<{ number: number; title: string }>
  ): Promise<void> {
    for (const issue of issues) {
      try {
        await this.githubClient.commentOnIssue(
          repo,
          issue.number,
          `PR: #${prNumber}`
        );
      } catch {
        // Ignore errors commenting on issues
      }
    }
  }

  /**
   * Add PR to watch list.
   */
  private async watchPr(repo: string, pr: IGhPrResponse): Promise<void> {
    try {
      const userId = await this.prRepository.getUserId();
      await this.prRepository.upsertPr(userId, {
        number: pr.number,
        repo,
        title: pr.title,
        status: pr.isDraft ? 'open' : 'open',
        watching: true,
      });
    } catch {
      // Ignore errors watching PR
    }
  }

  /**
   * Create Neo4j nodes and CLOSES relationships.
   */
  private async createNeo4jRelationships(
    repo: string,
    pr: IGhPrResponse,
    issues: Array<{ number: number; title: string }>
  ): Promise<void> {
    try {
      const userId = await this.prRepository.getUserId();

      // Upsert issues
      for (const issue of issues) {
        await this.prRepository.upsertIssue(userId, {
          number: issue.number,
          repo,
          title: issue.title,
          url: `https://github.com/${repo}/issues/${issue.number}`,
        });
      }

      // Create CLOSES relationships
      await this.prRepository.linkPrToIssues(
        userId,
        repo,
        pr.number,
        issues.map(i => i.number)
      );
    } catch {
      // Ignore errors creating relationships
    }
  }
}
