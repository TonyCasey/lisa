/**
 * Pull Request Repository Interface.
 *
 * Unlike Memory/Task repositories which use MCP for writes,
 * the PR repository writes directly to Neo4j for immediate persistence.
 *
 * PRs are user-scoped (group_id: "user:<git-config-name>") not project-scoped.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type {
  IPullRequest,
  IGitHubIssue,
  IPrCheck,
  IPrComment,
  IPullRequestInput,
  IGitHubIssueInput,
  IPullRequestWithRelations,
} from '../types/IPullRequest';

/**
 * Query options for PR repository.
 */
export interface IPullRequestQueryOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly repo?: string;  // Filter by repo (owner/repo format)
}

/**
 * Result from PR queries.
 */
export interface IPullRequestQueryResult {
  readonly items: readonly IPullRequest[];
  readonly hasMore: boolean;
}

/**
 * Reader interface for PR repository.
 */
export interface IPullRequestRepositoryReader {
  /**
   * Get the user ID for PR storage (from git config).
   * Returns format: "user:<git-config-name>"
   */
  getUserId(): Promise<string>;

  /**
   * Find a specific PR.
   */
  findPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<IPullRequest | null>;

  /**
   * Find all watched PRs for a user.
   */
  findWatchedPrs(
    userId: string,
    options?: IPullRequestQueryOptions
  ): Promise<IPullRequestQueryResult>;

  /**
   * Find a specific issue.
   */
  findIssue(
    userId: string,
    repo: string,
    issueNumber: number
  ): Promise<IGitHubIssue | null>;

  /**
   * Find all issues linked to a PR.
   */
  findIssuesByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IGitHubIssue[]>;

  /**
   * Find all PRs that close an issue.
   */
  findPrsByIssue(
    userId: string,
    repo: string,
    issueNumber: number
  ): Promise<readonly IPullRequest[]>;

  /**
   * Find all checks for a PR.
   */
  findChecksByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IPrCheck[]>;

  /**
   * Find all comments for a PR.
   */
  findCommentsByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IPrComment[]>;

  /**
   * Get PR with all related entities (issues, checks, comments).
   */
  getPrWithRelations(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<IPullRequestWithRelations | null>;
}

/**
 * Writer interface for PR repository.
 */
export interface IPullRequestRepositoryWriter {
  /**
   * Create or update a PR.
   */
  upsertPr(userId: string, pr: IPullRequestInput): Promise<IPullRequest>;

  /**
   * Create or update an issue.
   */
  upsertIssue(userId: string, issue: IGitHubIssueInput): Promise<IGitHubIssue>;

  /**
   * Create or update a check.
   */
  upsertCheck(
    userId: string,
    repo: string,
    prNumber: number,
    check: Omit<IPrCheck, 'type' | 'uuid' | 'created_at'>
  ): Promise<IPrCheck>;

  /**
   * Create or update a comment.
   */
  upsertComment(
    userId: string,
    repo: string,
    prNumber: number,
    comment: Omit<IPrComment, 'type' | 'uuid'>
  ): Promise<IPrComment>;

  /**
   * Link a PR to issues (creates CLOSES relationships).
   */
  linkPrToIssues(
    userId: string,
    repo: string,
    prNumber: number,
    issueNumbers: readonly number[]
  ): Promise<void>;

  /**
   * Update PR watching status.
   */
  setWatching(
    userId: string,
    repo: string,
    prNumber: number,
    watching: boolean
  ): Promise<void>;

  /**
   * Update PR poll timestamp.
   */
  updateLastPolled(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<void>;

  /**
   * Delete a PR and its relationships.
   */
  deletePr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<void>;
}

/**
 * Capabilities interface for PR repository.
 */
export interface IPullRequestRepositoryCapabilities {
  /**
   * PR repository supports writes (unlike read-only Memory/Task Neo4j repos).
   */
  supportsWrite(): boolean;

  /**
   * PR repository supports relationship queries.
   */
  supportsRelationships(): boolean;
}

/**
 * Full PR repository interface.
 */
export interface IPullRequestRepository
  extends IPullRequestRepositoryReader,
    IPullRequestRepositoryWriter,
    IPullRequestRepositoryCapabilities {}
