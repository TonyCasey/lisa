/**
 * GitHub Client Interface
 *
 * Domain interface for GitHub operations.
 * Implemented by GithubClient in the infrastructure layer.
 *
 * This interface ensures the application layer doesn't depend
 * directly on infrastructure implementations.
 */

import type {
  IGhPrResponse,
  IGhCheckResponse,
  IGhReviewCommentResponse,
  IGhIssueResponse,
  IGhUserResponse,
} from '../../../infrastructure/github/types';

/**
 * GitHub client interface for PR and repository operations.
 */
export interface IGithubClient {
  // PR Operations
  getPr(repo: string, prNumber: number): Promise<IGhPrResponse>;
  getPrChecks(repo: string, prNumber: number): Promise<readonly IGhCheckResponse[]>;
  getPrComments(repo: string, prNumber: number): Promise<readonly IGhReviewCommentResponse[]>;
  getPrDiff(repo: string, prNumber: number): Promise<string>;

  // Issue Operations
  getIssue(repo: string, issueNumber: number): Promise<IGhIssueResponse>;

  // Comment Operations
  replyToComment(repo: string, commentId: number, body: string): Promise<IGhReviewCommentResponse>;
  addReaction(
    repo: string,
    commentId: number,
    reaction: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'
  ): Promise<void>;

  // User Operations
  getCurrentUser(): Promise<IGhUserResponse>;
  getUserId(): Promise<string>;

  // Repository Operations
  getCurrentRepo(): Promise<string>;

  // Git Operations
  getCurrentBranch(): Promise<string>;
  getDefaultBranch(repo: string): Promise<string>;
  getCommitMessages(base: string, head?: string): Promise<readonly string[]>;
  getChangedFiles(base: string, head?: string): Promise<readonly string[]>;

  // Issue Operations
  commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void>;

  // PR Creation
  createPr(options: {
    repo: string;
    title: string;
    body: string;
    base?: string;
    head?: string;
    draft?: boolean;
  }): Promise<IGhPrResponse>;

  // Health Check
  isAvailable(): Promise<boolean>;
}
