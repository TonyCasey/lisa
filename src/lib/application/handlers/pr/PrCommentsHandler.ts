/**
 * PR Comments Handler
 *
 * Fetches and displays PR review comments with triage information.
 * Supports filtering by status (pending, addressed, resolved).
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { GithubClient } from '../../../infrastructure/github';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { CommentStatus } from '../../../domain/interfaces/types/IPullRequest';

/**
 * Comment with triage information.
 */
export interface ITriagedComment {
  readonly id: number;
  readonly file: string;
  readonly line?: number;
  readonly author: string;
  readonly body: string;
  readonly status: CommentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly htmlUrl: string;
  readonly isReply: boolean;
  readonly inReplyToId?: number;
}

/**
 * Result from PrCommentsHandler.
 */
export interface IPrCommentsResult {
  readonly repo: string;
  readonly prNumber: number;
  readonly title?: string;
  readonly comments: readonly ITriagedComment[];
  readonly summary: {
    readonly total: number;
    readonly pending: number;
    readonly addressed: number;
    readonly resolved: number;
  };
  readonly formattedOutput: string;
}

/**
 * Options for PrCommentsHandler.
 */
export interface IPrCommentsOptions {
  readonly repo?: string;  // If not provided, uses current repo
  readonly prNumber: number;
  readonly filter?: CommentStatus;  // Filter by status
  readonly saveToNeo4j?: boolean;   // Default: true
}

/**
 * Handler for fetching PR comments.
 */
export class PrCommentsHandler {
  constructor(
    private readonly githubClient: GithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Get PR review comments with triage information.
   */
  async execute(options: IPrCommentsOptions): Promise<IPrCommentsResult> {
    // Resolve repo
    const repo = options.repo || await this.githubClient.getCurrentRepo();

    // Fetch PR details for title
    let title: string | undefined;
    try {
      const pr = await this.githubClient.getPr(repo, options.prNumber);
      title = pr.title;
    } catch {
      // PR might not exist
    }

    // Fetch comments from GitHub
    const ghComments = await this.githubClient.getPrComments(repo, options.prNumber);

    // Get existing comment statuses from Neo4j
    const existingStatuses = await this.getExistingStatuses(repo, options.prNumber);

    // Map and triage comments
    let comments = ghComments.map(comment => this.triageComment(comment, existingStatuses));

    // Apply filter if specified
    if (options.filter) {
      comments = comments.filter(c => c.status === options.filter);
    }

    // Calculate summary
    const allComments = ghComments.map(c => this.triageComment(c, existingStatuses));
    const summary = {
      total: allComments.length,
      pending: allComments.filter(c => c.status === 'pending').length,
      addressed: allComments.filter(c => c.status === 'addressed').length,
      resolved: allComments.filter(c => c.status === 'resolved').length,
    };

    // Optionally save to Neo4j
    if (options.saveToNeo4j !== false) {
      await this.saveCommentsToNeo4j(repo, options.prNumber, comments);
    }

    // Generate formatted output
    const formattedOutput = this.formatOutput(comments, summary, title);

    return {
      repo,
      prNumber: options.prNumber,
      title,
      comments,
      summary,
      formattedOutput,
    };
  }

  /**
   * Get existing comment statuses from Neo4j.
   */
  private async getExistingStatuses(
    repo: string,
    prNumber: number
  ): Promise<Map<string, CommentStatus>> {
    const statuses = new Map<string, CommentStatus>();

    try {
      const userId = await this.prRepository.getUserId();
      const comments = await this.prRepository.findCommentsByPr(userId, repo, prNumber);

      for (const comment of comments) {
        statuses.set(comment.commentId, comment.status);
      }
    } catch {
      // Return empty map if Neo4j fails
    }

    return statuses;
  }

  /**
   * Triage a comment to determine its status.
   */
  private triageComment(
    comment: {
      readonly id: number;
      readonly user: { readonly login: string };
      readonly body: string;
      readonly path: string;
      readonly line?: number;
      readonly original_line?: number;
      readonly created_at: string;
      readonly updated_at: string;
      readonly html_url: string;
      readonly in_reply_to_id?: number;
    },
    existingStatuses: Map<string, CommentStatus>
  ): ITriagedComment {
    const commentId = String(comment.id);

    // Use existing status if we have it
    let status: CommentStatus = existingStatuses.get(commentId) || 'pending';

    // Heuristic: if the comment is a reply and we authored it, mark as addressed
    // (This is a simple heuristic - in practice we'd check if it's our reply)
    if (comment.in_reply_to_id && !existingStatuses.has(commentId)) {
      // New reply we haven't tracked - keep as pending
      status = 'pending';
    }

    return {
      id: comment.id,
      file: comment.path,
      line: comment.line || comment.original_line,
      author: comment.user.login,
      body: comment.body,
      status,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      htmlUrl: comment.html_url,
      isReply: !!comment.in_reply_to_id,
      inReplyToId: comment.in_reply_to_id,
    };
  }

  /**
   * Save comments to Neo4j via repository.
   */
  private async saveCommentsToNeo4j(
    repo: string,
    prNumber: number,
    comments: readonly ITriagedComment[]
  ): Promise<void> {
    try {
      const userId = await this.prRepository.getUserId();

      for (const comment of comments) {
        await this.prRepository.upsertComment(userId, repo, prNumber, {
          commentId: String(comment.id),
          file: comment.file,
          line: comment.line || 0,
          author: comment.author,
          body: comment.body,
          status: comment.status,
          hasNewReply: false,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        });
      }
    } catch {
      // Non-fatal: comments are informational
    }
  }

  /**
   * Format output for display.
   */
  private formatOutput(
    comments: readonly ITriagedComment[],
    summary: { total: number; pending: number; addressed: number; resolved: number },
    title?: string
  ): string {
    const lines: string[] = [];

    // Header
    if (title) {
      lines.push(`PR: ${title}`);
      lines.push('');
    }

    // Summary
    lines.push(`Comments: ${summary.total} total (${summary.pending} pending, ${summary.addressed} addressed, ${summary.resolved} resolved)`);
    lines.push('');

    if (comments.length === 0) {
      lines.push('No comments to display.');
      return lines.join('\n');
    }

    // Group by file
    const byFile = new Map<string, ITriagedComment[]>();
    for (const comment of comments) {
      const existing = byFile.get(comment.file) || [];
      existing.push(comment);
      byFile.set(comment.file, existing);
    }

    // Display by file
    for (const [file, fileComments] of byFile) {
      lines.push(`📁 ${file}`);

      for (const comment of fileComments) {
        const statusEmoji = {
          pending: '🔴',
          addressed: '🟡',
          resolved: '✅',
        };

        const lineInfo = comment.line ? `:${comment.line}` : '';
        const replyIndicator = comment.isReply ? ' (reply)' : '';

        lines.push(`  ${statusEmoji[comment.status]} Line${lineInfo} - @${comment.author}${replyIndicator}`);

        // Truncate long bodies
        const bodyPreview = comment.body.length > 100
          ? comment.body.slice(0, 100).replace(/\n/g, ' ') + '...'
          : comment.body.replace(/\n/g, ' ');
        lines.push(`    "${bodyPreview}"`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}
