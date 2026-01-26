/**
 * GitHub Pull Request domain types.
 *
 * These types support Lisa's PR workflow feature, storing PR data
 * in Neo4j with user-scoped group_id (e.g., "user:tonycasey").
 *
 * @see .dev/features/github-pr.md for full specification
 */

/**
 * PR status values.
 */
export type PullRequestStatus = 'open' | 'merged' | 'closed';

/**
 * PR check status values.
 */
export type CheckStatus = 'pending' | 'success' | 'failure' | 'skipped';

/**
 * PR comment status values.
 */
export type CommentStatus = 'pending' | 'addressed' | 'resolved';

/**
 * GitHub Issue linked to a PR.
 */
export interface IGitHubIssue {
  readonly type: 'issue';
  readonly number: number;
  readonly repo: string;           // "owner/repo" format
  readonly title: string;
  readonly status: 'open' | 'closed';
  readonly url: string;
  readonly uuid?: string;          // Neo4j UUID
  readonly created_at?: string;    // ISO timestamp
}

/**
 * GitHub Pull Request.
 */
export interface IPullRequest {
  readonly type: 'pull_request';
  readonly number: number;
  readonly repo: string;           // "owner/repo" format
  readonly title: string;
  readonly status: PullRequestStatus;
  readonly watching: boolean;
  readonly watchingSince?: string; // ISO timestamp
  readonly lastPolled?: string;    // ISO timestamp
  readonly checksStatus: CheckStatus;
  readonly unresolvedComments: number;
  readonly uuid?: string;          // Neo4j UUID
  readonly created_at?: string;    // ISO timestamp
}

/**
 * PR CI check status.
 */
export interface IPrCheck {
  readonly type: 'pr_check';
  readonly checkName: string;
  readonly status: CheckStatus;
  readonly conclusion?: string;
  readonly detailsUrl?: string;
  readonly updatedAt: string;      // ISO timestamp
  readonly uuid?: string;          // Neo4j UUID
  readonly created_at?: string;    // ISO timestamp
}

/**
 * PR review comment.
 */
export interface IPrComment {
  readonly type: 'pr_comment';
  readonly commentId: string;
  readonly file: string;
  readonly line: number;
  readonly author: string;
  readonly body: string;
  readonly status: CommentStatus;
  readonly ourReplyId?: string;
  readonly hasNewReply: boolean;
  readonly createdAt: string;      // ISO timestamp
  readonly updatedAt: string;      // ISO timestamp
  readonly uuid?: string;          // Neo4j UUID
}

/**
 * Input for creating/updating a PR.
 */
export interface IPullRequestInput {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly status?: PullRequestStatus;
  readonly watching?: boolean;
}

/**
 * Input for creating/updating an issue.
 */
export interface IGitHubIssueInput {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly status?: 'open' | 'closed';
  readonly url: string;
}

/**
 * PR with all related entities.
 */
export interface IPullRequestWithRelations {
  readonly pr: IPullRequest;
  readonly issues: readonly IGitHubIssue[];
  readonly checks: readonly IPrCheck[];
  readonly comments: readonly IPrComment[];
}

/**
 * Create a default PR object.
 */
export function createPullRequest(input: IPullRequestInput): IPullRequest {
  return {
    type: 'pull_request',
    number: input.number,
    repo: input.repo,
    title: input.title,
    status: input.status ?? 'open',
    watching: input.watching ?? true,
    watchingSince: input.watching !== false ? new Date().toISOString() : undefined,
    checksStatus: 'pending',
    unresolvedComments: 0,
  };
}

/**
 * Create a default issue object.
 */
export function createGitHubIssue(input: IGitHubIssueInput): IGitHubIssue {
  return {
    type: 'issue',
    number: input.number,
    repo: input.repo,
    title: input.title,
    status: input.status ?? 'open',
    url: input.url,
  };
}
