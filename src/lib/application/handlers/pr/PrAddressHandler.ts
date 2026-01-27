/**
 * PR Address Handler
 *
 * Fetches pending PR comments and outputs them in a format suitable for
 * AI assistants to analyze and address. The handler provides:
 * - Comment details with file/line context
 * - Relevant code snippets
 * - Instructions for how to address each comment type
 *
 * The actual code changes and replies are made by the AI assistant,
 * not by this handler.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { CommentStatus } from '../../../domain/interfaces/types/IPullRequest';

/**
 * Comment with context for addressing.
 */
export interface ICommentToAddress {
  readonly id: number;
  readonly file: string;
  readonly line?: number;
  readonly author: string;
  readonly body: string;
  readonly status: CommentStatus;
  readonly htmlUrl: string;
  readonly codeContext?: string;  // Surrounding code lines
  readonly diffHunk?: string;     // The diff hunk from the review
  readonly commentType: CommentType;
}

/**
 * Type of comment - determines how to address it.
 */
export type CommentType = 
  | 'code_change'      // Reviewer wants code changed
  | 'question'         // Reviewer asking a question
  | 'suggestion'       // Optional improvement suggestion
  | 'nitpick'          // Minor style/formatting issue
  | 'approval'         // Positive feedback, no action needed
  | 'unknown';         // Could not categorize

/**
 * Result from PrAddressHandler.
 */
export interface IPrAddressResult {
  readonly success: boolean;
  readonly repo: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly title?: string;
  readonly commentsToAddress: readonly ICommentToAddress[];
  readonly summary: {
    readonly total: number;
    readonly codeChanges: number;
    readonly questions: number;
    readonly suggestions: number;
    readonly nitpicks: number;
  };
  readonly instructions: string;
  readonly formattedOutput: string;
}

/**
 * Options for PrAddressHandler.
 */
export interface IPrAddressOptions {
  readonly repo?: string;
  readonly prNumber: number;
  readonly includeResolved?: boolean;  // Include already resolved comments
  readonly codeContextLines?: number;  // Lines of context around the comment (default: 10)
}

/**
 * Handler for preparing PR comments to be addressed.
 */
export class PrAddressHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Fetch and prepare PR comments for addressing.
   */
  async execute(options: IPrAddressOptions): Promise<IPrAddressResult> {
    // Resolve repo
    const repo = options.repo || await this.githubClient.getCurrentRepo();
    const contextLines = options.codeContextLines ?? 10;

    // Fetch PR details
    const pr = await this.githubClient.getPr(repo, options.prNumber);
    const branch = pr.headRefName;
    const title = pr.title;

    // Fetch comments from GitHub
    const ghComments = await this.githubClient.getPrComments(repo, options.prNumber);

    // Get existing comment statuses from Neo4j
    const existingStatuses = await this.getExistingStatuses(repo, options.prNumber);

    // Filter to pending comments (unless includeResolved is true)
    const pendingComments = ghComments.filter(c => {
      const status = existingStatuses.get(String(c.id)) || 'pending';
      if (options.includeResolved) return true;
      return status === 'pending';
    });

    // Filter out replies (we want top-level comments only)
    const topLevelComments = pendingComments.filter(c => !c.in_reply_to_id);

    // Enrich comments with context
    const commentsToAddress: ICommentToAddress[] = [];
    for (const comment of topLevelComments) {
      const status = existingStatuses.get(String(comment.id)) || 'pending';
      const commentType = this.categorizeComment(comment.body);
      const codeContext = await this.getCodeContext(comment.path, comment.line || comment.original_line, contextLines);

      commentsToAddress.push({
        id: comment.id,
        file: comment.path,
        line: comment.line || comment.original_line,
        author: comment.user.login,
        body: comment.body,
        status,
        htmlUrl: comment.html_url,
        codeContext,
        diffHunk: comment.diff_hunk,
        commentType,
      });
    }

    // Calculate summary
    const summary = {
      total: commentsToAddress.length,
      codeChanges: commentsToAddress.filter(c => c.commentType === 'code_change').length,
      questions: commentsToAddress.filter(c => c.commentType === 'question').length,
      suggestions: commentsToAddress.filter(c => c.commentType === 'suggestion').length,
      nitpicks: commentsToAddress.filter(c => c.commentType === 'nitpick').length,
    };

    // Generate instructions
    const instructions = this.generateInstructions(commentsToAddress, repo, options.prNumber);

    // Format output
    const formattedOutput = this.formatOutput(commentsToAddress, summary, title, branch, instructions);

    return {
      success: true,
      repo,
      prNumber: options.prNumber,
      branch,
      title,
      commentsToAddress,
      summary,
      instructions,
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
   * Categorize the comment type based on content analysis.
   */
  private categorizeComment(body: string): CommentType {
    const lowerBody = body.toLowerCase();

    // Check for approval/positive feedback
    if (
      lowerBody.includes('lgtm') ||
      lowerBody.includes('looks good') ||
      lowerBody.includes('great work') ||
      lowerBody.includes('nice!') ||
      lowerBody.includes('👍')
    ) {
      return 'approval';
    }

    // Check for questions
    if (
      body.includes('?') ||
      lowerBody.includes('why') ||
      lowerBody.includes('could you explain') ||
      lowerBody.includes('what is') ||
      lowerBody.includes('how does')
    ) {
      return 'question';
    }

    // Check for nitpicks
    if (
      lowerBody.includes('nit:') ||
      lowerBody.includes('nitpick') ||
      lowerBody.includes('minor:') ||
      lowerBody.includes('style:') ||
      lowerBody.includes('typo')
    ) {
      return 'nitpick';
    }

    // Check for suggestions (optional changes)
    if (
      lowerBody.includes('consider') ||
      lowerBody.includes('suggestion') ||
      lowerBody.includes('might want to') ||
      lowerBody.includes('could also') ||
      lowerBody.includes('optional') ||
      lowerBody.includes('nice to have')
    ) {
      return 'suggestion';
    }

    // Check for code change requests
    if (
      lowerBody.includes('should') ||
      lowerBody.includes('must') ||
      lowerBody.includes('need to') ||
      lowerBody.includes('please') ||
      lowerBody.includes('fix') ||
      lowerBody.includes('change') ||
      lowerBody.includes('update') ||
      lowerBody.includes('add') ||
      lowerBody.includes('remove') ||
      lowerBody.includes('missing') ||
      lowerBody.includes('incorrect') ||
      lowerBody.includes('bug') ||
      lowerBody.includes('issue') ||
      lowerBody.includes('potential issue') ||
      lowerBody.includes('⚠️')
    ) {
      return 'code_change';
    }

    return 'unknown';
  }

  /**
   * Get code context around the comment line.
   */
  private async getCodeContext(
    filePath: string,
    line: number | undefined,
    contextLines: number
  ): Promise<string | undefined> {
    if (!line) return undefined;

    try {
      // Try to read the file from the current working directory
      const fullPath = path.resolve(process.cwd(), filePath);
      
      if (!await fs.pathExists(fullPath)) {
        return undefined;
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      const startLine = Math.max(0, line - contextLines - 1);
      const endLine = Math.min(lines.length, line + contextLines);

      const contextWithLineNumbers = lines
        .slice(startLine, endLine)
        .map((lineContent, i) => {
          const lineNum = startLine + i + 1;
          const marker = lineNum === line ? '>>>' : '   ';
          return `${marker} ${lineNum.toString().padStart(4)}: ${lineContent}`;
        })
        .join('\n');

      return contextWithLineNumbers;
    } catch {
      return undefined;
    }
  }

  /**
   * Generate instructions for addressing comments.
   */
  private generateInstructions(
    comments: readonly ICommentToAddress[],
    repo: string,
    prNumber: number
  ): string {
    const lines: string[] = [];

    lines.push('## Instructions for Addressing PR Comments');
    lines.push('');
    lines.push('For each comment below, please:');
    lines.push('');
    lines.push('1. **Analyze** the comment and understand what is being requested');
    lines.push('2. **Make changes** to the code if needed');
    lines.push('3. **Reply** to the comment on GitHub explaining what was done');
    lines.push('');
    lines.push('### How to handle each comment type:');
    lines.push('');
    lines.push('- **code_change**: Make the requested code changes, commit, then reply with the commit hash');
    lines.push('- **question**: Reply with an explanation (no code changes needed unless clarification reveals an issue)');
    lines.push('- **suggestion**: Evaluate if the suggestion improves the code. If yes, implement it. If no, reply explaining why');
    lines.push('- **nitpick**: Fix if trivial, otherwise acknowledge and optionally defer');
    lines.push('- **approval**: No action needed, but you can reply with thanks');
    lines.push('');
    lines.push('### Reply format:');
    lines.push('');
    lines.push('After making changes, reply to each comment using:');
    lines.push('```');
    lines.push(`gh api repos/${repo}/pulls/comments/{COMMENT_ID}/replies -f body="Your reply here"`);
    lines.push('```');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format output for display.
   */
  private formatOutput(
    comments: readonly ICommentToAddress[],
    summary: { total: number; codeChanges: number; questions: number; suggestions: number; nitpicks: number },
    title: string | undefined,
    branch: string,
    instructions: string
  ): string {
    const lines: string[] = [];

    // Header
    if (title) {
      lines.push(`# PR: ${title}`);
      lines.push(`Branch: ${branch}`);
      lines.push('');
    }

    // Summary
    lines.push(`## Summary: ${summary.total} comment(s) to address`);
    if (summary.codeChanges > 0) lines.push(`- 🔧 ${summary.codeChanges} code change(s) requested`);
    if (summary.questions > 0) lines.push(`- ❓ ${summary.questions} question(s) to answer`);
    if (summary.suggestions > 0) lines.push(`- 💡 ${summary.suggestions} suggestion(s) to consider`);
    if (summary.nitpicks > 0) lines.push(`- 📝 ${summary.nitpicks} nitpick(s)`);
    lines.push('');

    if (comments.length === 0) {
      lines.push('No pending comments to address! 🎉');
      return lines.join('\n');
    }

    // Instructions
    lines.push(instructions);

    // Comments
    lines.push('---');
    lines.push('');
    lines.push('## Comments to Address');
    lines.push('');

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const typeEmoji = {
        code_change: '🔧',
        question: '❓',
        suggestion: '💡',
        nitpick: '📝',
        approval: '✅',
        unknown: '❔',
      };

      lines.push(`### ${i + 1}. ${typeEmoji[comment.commentType]} ${comment.commentType.toUpperCase()} - ${comment.file}:${comment.line || '?'}`);
      lines.push('');
      lines.push(`**Author:** @${comment.author}`);
      lines.push(`**Comment ID:** ${comment.id}`);
      lines.push(`**URL:** ${comment.htmlUrl}`);
      lines.push('');
      lines.push('**Comment:**');
      lines.push('```');
      lines.push(comment.body);
      lines.push('```');
      lines.push('');

      if (comment.codeContext) {
        lines.push('**Code context:**');
        lines.push('```');
        lines.push(comment.codeContext);
        lines.push('```');
        lines.push('');
      }

      if (comment.diffHunk) {
        lines.push('<details>');
        lines.push('<summary>Diff hunk</summary>');
        lines.push('');
        lines.push('```diff');
        lines.push(comment.diffHunk);
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
