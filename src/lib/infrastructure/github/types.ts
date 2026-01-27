/**
 * GitHub API Response Types
 *
 * These types represent the raw responses from the GitHub API via `gh` CLI.
 * They are transformed into domain types (IPullRequest, etc.) by the GithubClient.
 *
 * @see .dev/features/github-pr.md for full specification
 */

/**
 * Raw PR data from `gh pr view --json`.
 */
export interface IGhPrResponse {
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED';
  readonly body: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly url: string;
  readonly isDraft: boolean;
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closingIssuesReferences?: readonly {
    readonly number: number;
    readonly title: string;
    readonly url: string;
  }[];
  readonly author: {
    readonly login: string;
  };
  readonly headRepository: {
    readonly nameWithOwner: string;
  };
}

/**
 * Raw check data from `gh pr checks --json`.
 */
export interface IGhCheckResponse {
  readonly name: string;
  readonly state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'CANCELLED' | 'QUEUED' | 'IN_PROGRESS';
  readonly conclusion?: string;
  readonly detailsUrl?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

/**
 * Raw review data from `gh api repos/{owner}/{repo}/pulls/{pr}/reviews`.
 */
export interface IGhReviewResponse {
  readonly id: number;
  readonly user: {
    readonly login: string;
  };
  readonly body: string;
  readonly state: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  readonly submitted_at: string;
  readonly html_url: string;
}

/**
 * Raw review comment from `gh api repos/{owner}/{repo}/pulls/{pr}/comments`.
 */
export interface IGhReviewCommentResponse {
  readonly id: number;
  readonly user: {
    readonly login: string;
  };
  readonly body: string;
  readonly path: string;
  readonly line?: number;
  readonly original_line?: number;
  readonly position?: number;
  readonly diff_hunk: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly html_url: string;
  readonly in_reply_to_id?: number;
}

/**
 * Raw issue data from `gh issue view --json`.
 */
export interface IGhIssueResponse {
  readonly number: number;
  readonly title: string;
  readonly state: 'OPEN' | 'CLOSED';
  readonly body: string;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: readonly {
    readonly name: string;
  }[];
  readonly author: {
    readonly login: string;
  };
}

/**
 * Raw user data from `gh api user`.
 */
export interface IGhUserResponse {
  readonly login: string;
  readonly id: number;
  readonly name?: string;
  readonly email?: string;
}

/**
 * Review thread with resolution status from GraphQL API.
 */
export interface IGhReviewThreadResponse {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly comments: {
    readonly nodes: readonly {
      readonly id: string;
      readonly databaseId: number;
      readonly body: string;
      readonly author: {
        readonly login: string;
      } | null;
      readonly path: string;
      readonly line: number | null;
    }[];
  };
}

/**
 * Error thrown when gh CLI is not installed or not authenticated.
 */
export class GithubClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_INSTALLED' | 'NOT_AUTHENTICATED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'API_ERROR' | 'UNKNOWN',
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'GithubClientError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Options for GithubClient methods.
 */
export interface IGithubClientOptions {
  /** Maximum number of retries for transient failures */
  readonly maxRetries?: number;
  /** Delay between retries in milliseconds */
  readonly retryDelayMs?: number;
  /** Timeout for each command in milliseconds */
  readonly timeoutMs?: number;
}
