/**
 * PR Poll Handler
 *
 * Polls all watched PRs for a user and detects state changes.
 * Designed to be invoked by cron (no TTY) every 5 minutes.
 *
 * User-scoped: polls ALL watched PRs across all repos in a single invocation.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type {
  IPullRequest,
  CheckStatus,
  PullRequestStatus,
  IPrCheck,
  IPrComment,
} from '../../../domain/interfaces/types/IPullRequest';
import type { IGhCheckResponse, IGhReviewCommentResponse } from '../../../infrastructure/github/types';
import { GithubClientError } from '../../../infrastructure/github/types';
import type { INotificationService, INotification } from '../../../domain/interfaces/INotificationService';
import { createNotificationFromStateChange } from '../../../infrastructure/notifications/NotificationService';

/**
 * State change detected during polling.
 */
export interface IStateChange {
  readonly type:
    | 'checks_updated'
    | 'new_comment'
    | 'comment_resolved'
    | 'pr_approved'
    | 'pr_merged'
    | 'pr_closed'
    | 'new_reply';
  readonly description: string;
  readonly prNumber: number;
  readonly repo: string;
}

/**
 * Result for a single PR poll.
 */
export interface IPrPollItem {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly previousState: {
    readonly status: PullRequestStatus;
    readonly checksStatus: CheckStatus;
    readonly unresolvedComments: number;
  };
  readonly currentState: {
    readonly status: PullRequestStatus;
    readonly checksStatus: CheckStatus;
    readonly unresolvedComments: number;
  };
  readonly changes: readonly IStateChange[];
  readonly unwatched: boolean;
  readonly error?: string;
}

/**
 * Result from PrPollHandler.
 */
export interface IPrPollResult {
  readonly success: boolean;
  readonly message: string;
  readonly polledAt: string;
  readonly totalWatched: number;
  readonly totalChanges: number;
  readonly totalErrors: number;
  readonly items: readonly IPrPollItem[];
  readonly logPath?: string;
}

/**
 * Options for poll command.
 */
export interface IPrPollOptions {
  /** Auto-unwatch merged/closed PRs (default: true) */
  readonly autoUnwatch?: boolean;
  /** Write logs to file (default: true) */
  readonly logToFile?: boolean;
  /** Limit concurrent GitHub API calls (default: 5) */
  readonly concurrency?: number;
  /** Send desktop notifications for state changes (default: false) */
  readonly notify?: boolean;
}

/**
 * Handler for PR polling operations.
 */
export class PrPollHandler {
  private readonly logPath: string;

  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository,
    private readonly notificationService?: INotificationService
  ) {
    this.logPath = path.join(os.homedir(), '.lisa', 'pr-poll.log');
  }

  /**
   * Poll all watched PRs for the current user.
   */
  async poll(options?: IPrPollOptions): Promise<IPrPollResult> {
    const polledAt = new Date().toISOString();
    const autoUnwatch = options?.autoUnwatch ?? true;
    const logToFile = options?.logToFile ?? true;
    const notify = options?.notify ?? false;
    // Guard against zero/negative concurrency to prevent infinite loops
    const concurrency = Math.max(1, options?.concurrency ?? 5);

    const logs: string[] = [];
    const log = (message: string) => {
      const entry = `[${new Date().toISOString()}] ${message}`;
      logs.push(entry);
    };

    try {
      // Get user ID
      const userId = await this.prRepository.getUserId();

      // Query watched PRs (max 10 to avoid rate limiting)
      const MAX_WATCHED_PRS = 10;
      const { items: watchedPrs } = await this.prRepository.findWatchedPrs(userId, {
        limit: MAX_WATCHED_PRS,
      });

      log(`Polling ${watchedPrs.length} watched PR(s)...`);

      if (watchedPrs.length === 0) {
        log('Poll complete. 0 notifications.');

        if (logToFile) {
          await this.writeLog(logs);
        }

        return {
          success: true,
          message: 'No PRs being watched',
          polledAt,
          totalWatched: 0,
          totalChanges: 0,
          totalErrors: 0,
          items: [],
          logPath: logToFile ? this.logPath : undefined,
        };
      }

      // Poll PRs with controlled concurrency
      const pollResults: IPrPollItem[] = [];
      const batches = this.batchArray(watchedPrs, concurrency);

      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(pr => this.pollSinglePr(pr, userId, autoUnwatch, log))
        );
        pollResults.push(...batchResults);
      }

      // Calculate totals
      const totalChanges = pollResults.reduce((sum, r) => sum + r.changes.length, 0);
      const totalErrors = pollResults.filter(r => r.error).length;

      // Send desktop notifications if enabled
      if (notify && this.notificationService && totalChanges > 0) {
        const notifications = this.collectNotifications(pollResults);
        await this.notificationService.notifyBatch(notifications);
        log(`Sent ${notifications.length} desktop notification(s).`);
      }

      log(`Poll complete. ${totalChanges} notification(s).`);

      // Write to log file
      let logPath: string | undefined;
      if (logToFile) {
        await this.writeLog(logs);
        logPath = this.logPath;
      }

      return {
        success: totalErrors === 0,
        message: totalErrors > 0
          ? `Polled ${watchedPrs.length} PR(s) with ${totalErrors} error(s)`
          : `Polled ${watchedPrs.length} PR(s), ${totalChanges} change(s) detected`,
        polledAt,
        totalWatched: watchedPrs.length,
        totalChanges,
        totalErrors,
        items: pollResults,
        logPath,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      log(`ERROR: ${message}`);

      if (logToFile) {
        await this.writeLog(logs);
      }

      return {
        success: false,
        message: `Poll failed: ${message}`,
        polledAt,
        totalWatched: 0,
        totalChanges: 0,
        totalErrors: 1,
        items: [],
        logPath: logToFile ? this.logPath : undefined,
      };
    }
  }

  /**
   * Poll a single PR and detect changes.
   */
  private async pollSinglePr(
    pr: IPullRequest,
    userId: string,
    autoUnwatch: boolean,
    log: (message: string) => void
  ): Promise<IPrPollItem> {
    const changes: IStateChange[] = [];
    let unwatched = false;
    let error: string | undefined;

    const previousState = {
      status: pr.status,
      checksStatus: pr.checksStatus,
      unresolvedComments: pr.unresolvedComments,
    };

    let currentState = { ...previousState };

    try {
      // Fetch current state from GitHub
      const ghPr = await this.githubClient.getPr(pr.repo, pr.number);
      const ghChecks = await this.githubClient.getPrChecks(pr.repo, pr.number);
      const ghComments = await this.githubClient.getPrComments(pr.repo, pr.number);

      // Map GitHub state to domain
      const newStatus = this.mapPrStatus(ghPr.state);
      const newChecksStatus = this.calculateOverallCheckStatus(ghChecks);
      const newUnresolvedComments = this.countUnresolvedComments(ghComments);

      currentState = {
        status: newStatus,
        checksStatus: newChecksStatus,
        unresolvedComments: newUnresolvedComments,
      };

      // Detect state changes
      if (previousState.checksStatus !== newChecksStatus) {
        const change: IStateChange = {
          type: 'checks_updated',
          description: `checks ${previousState.checksStatus} → ${newChecksStatus} ${newChecksStatus === 'success' ? '✅' : newChecksStatus === 'failure' ? '❌' : ''}`,
          prNumber: pr.number,
          repo: pr.repo,
        };
        changes.push(change);
        log(`${pr.repo}#${pr.number}: ${change.description}`);
      }

      // Check for status changes
      if (previousState.status !== newStatus) {
        if (newStatus === 'merged') {
          const change: IStateChange = {
            type: 'pr_merged',
            description: 'PR merged',
            prNumber: pr.number,
            repo: pr.repo,
          };
          changes.push(change);
          log(`${pr.repo}#${pr.number}: PR merged`);
        } else if (newStatus === 'closed') {
          const change: IStateChange = {
            type: 'pr_closed',
            description: 'PR closed',
            prNumber: pr.number,
            repo: pr.repo,
          };
          changes.push(change);
          log(`${pr.repo}#${pr.number}: PR closed`);
        }
      }

      // Check for new comments
      const previousComments = await this.prRepository.findCommentsByPr(userId, pr.repo, pr.number);
      const newCommentChanges = await this.detectNewComments(
        pr,
        previousComments,
        ghComments,
        userId,
        log
      );
      changes.push(...newCommentChanges);

      // Update Neo4j with new state (including checksStatus and unresolvedComments)
      await this.prRepository.upsertPr(userId, {
        number: pr.number,
        repo: pr.repo,
        title: ghPr.title,
        status: newStatus,
        watching: true,
        checksStatus: newChecksStatus,
        unresolvedComments: newUnresolvedComments,
      });

      // Update checks in Neo4j
      // Update checks in Neo4j (parallel for performance)
      await Promise.all(ghChecks.map(check =>
        this.prRepository.upsertCheck(userId, pr.repo, pr.number, {
          checkName: check.name,
          status: this.mapCheckStatus(check.state),
          conclusion: check.conclusion,
          detailsUrl: check.detailsUrl,
          updatedAt: check.completedAt || check.startedAt || new Date().toISOString(),
        })
      ));

      // Update poll timestamp
      await this.prRepository.updateLastPolled(userId, pr.repo, pr.number);

      // Auto-unwatch if merged/closed
      if (autoUnwatch && (newStatus === 'merged' || newStatus === 'closed')) {
        await this.prRepository.setWatching(userId, pr.repo, pr.number, false);
        unwatched = true;
        log(`${pr.repo}#${pr.number}: PR ${newStatus}, unwatching`);
      } else if (changes.length === 0) {
        log(`${pr.repo}#${pr.number}: no changes`);
      }
    } catch (err) {
      error = this.getErrorMessage(err);

      // Handle rate limiting gracefully
      if (err instanceof GithubClientError && err.code === 'RATE_LIMITED') {
        log(`${pr.repo}#${pr.number}: rate limited, skipping`);
      } else {
        log(`${pr.repo}#${pr.number}: ERROR ${error}`);
      }
    }

    return {
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      previousState,
      currentState,
      changes,
      unwatched,
      error,
    };
  }

  /**
   * Detect new comments and replies.
   */
  private async detectNewComments(
    pr: IPullRequest,
    previousComments: readonly IPrComment[],
    ghComments: readonly IGhReviewCommentResponse[],
    userId: string,
    log: (message: string) => void
  ): Promise<IStateChange[]> {
    const changes: IStateChange[] = [];
    const previousIds = new Set(previousComments.map(c => c.commentId));

    for (const ghComment of ghComments) {
      const commentId = String(ghComment.id);

      // Check if this is a new comment
      if (!previousIds.has(commentId)) {
        // Check if this is a reply to our previous response
        const isReplyToOurs = previousComments.some(
          c => c.ourReplyId && ghComment.in_reply_to_id === parseInt(c.ourReplyId, 10)
        );

        if (isReplyToOurs) {
          const change: IStateChange = {
            type: 'new_reply',
            description: `new reply from @${ghComment.user.login} on ${ghComment.path}:${ghComment.line || ghComment.original_line || '?'}`,
            prNumber: pr.number,
            repo: pr.repo,
          };
          changes.push(change);
          log(`${pr.repo}#${pr.number}: ${change.description}`);
        } else if (!ghComment.in_reply_to_id) {
          // New top-level comment (not a reply)
          const change: IStateChange = {
            type: 'new_comment',
            description: `new comment from @${ghComment.user.login} on ${ghComment.path}:${ghComment.line || ghComment.original_line || '?'}`,
            prNumber: pr.number,
            repo: pr.repo,
          };
          changes.push(change);
          log(`${pr.repo}#${pr.number}: ${change.description}`);
        }

        // Store the new comment in Neo4j
        await this.prRepository.upsertComment(userId, pr.repo, pr.number, {
          commentId,
          file: ghComment.path,
          line: ghComment.line || ghComment.original_line || 0,
          author: ghComment.user.login,
          body: ghComment.body,
          status: 'pending',
          hasNewReply: isReplyToOurs,
          createdAt: ghComment.created_at,
          updatedAt: ghComment.updated_at,
        });
      }
    }

    return changes;
  }

  /**
   * Calculate overall check status from individual checks.
   */
  private calculateOverallCheckStatus(checks: readonly IGhCheckResponse[]): CheckStatus {
    if (checks.length === 0) {
      return 'pending';
    }

    const hasFailure = checks.some(c => c.state === 'FAILURE');
    const hasCancelled = checks.some(c => c.state === 'CANCELLED');
    const allSuccess = checks.every(c => c.state === 'SUCCESS' || c.state === 'SKIPPED');
    const hasPending = checks.some(c => c.state === 'PENDING' || c.state === 'QUEUED' || c.state === 'IN_PROGRESS');

    if (hasFailure) return 'failure';
    if (hasCancelled) return 'cancelled';
    if (allSuccess) return 'success';
    if (hasPending) return 'pending';

    return 'pending';
  }

  /**
   * Count unresolved comments.
   */
  private countUnresolvedComments(comments: readonly IGhReviewCommentResponse[]): number {
    // Count unique top-level comment threads (not replies)
    const topLevelComments = comments.filter(c => !c.in_reply_to_id);
    return topLevelComments.length;
  }

  /**
   * Map GitHub PR state to domain status.
   */
  private mapPrStatus(state: 'OPEN' | 'CLOSED' | 'MERGED'): PullRequestStatus {
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
   * Map GitHub check state to domain status.
   */
  private mapCheckStatus(state: string): CheckStatus {
    switch (state) {
      case 'SUCCESS':
        return 'success';
      case 'FAILURE':
        return 'failure';
      case 'CANCELLED':
        return 'cancelled';
      case 'SKIPPED':
        return 'skipped';
      case 'PENDING':
      case 'QUEUED':
      case 'IN_PROGRESS':
      default:
        return 'pending';
    }
  }

  /**
   * Get error message from unknown error.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Write logs to file.
   */
  private async writeLog(logs: string[]): Promise<void> {
    try {
      const logDir = path.dirname(this.logPath);
      await fs.ensureDir(logDir);
      await fs.appendFile(this.logPath, logs.join('\n') + '\n');
    } catch {
      // Silently ignore log write failures (cron context)
    }
  }

  /**
   * Split array into batches.
   */
  private batchArray<T>(items: readonly T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize) as T[]);
    }
    return batches;
  }

  /**
   * Collect notifications from poll results.
   */
  private collectNotifications(pollResults: readonly IPrPollItem[]): INotification[] {
    const notifications: INotification[] = [];

    for (const item of pollResults) {
      for (const change of item.changes) {
        const notification = createNotificationFromStateChange(
          change.type,
          change.description,
          change.prNumber,
          change.repo,
          item.title
        );
        notifications.push(notification);
      }
    }

    return notifications;
  }
}
