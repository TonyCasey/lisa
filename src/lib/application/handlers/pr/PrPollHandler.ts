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
  IPrComment,
} from '../../../domain/interfaces/types/IPullRequest';
import { createPullRequest } from '../../../domain/interfaces/types/IPullRequest';
import type { IGhCheckResponse, IGhReviewCommentResponse, IGhReviewThreadResponse } from '../../../infrastructure/github/types';
import { GithubClientError } from '../../../infrastructure/github/types';
import type { INotificationService, INotification } from '../../../domain/interfaces/INotificationService';
import type { IMemoryWriter } from '../../../domain/interfaces/IMemoryService';
import { createNotificationFromStateChange } from '../../../infrastructure/notifications/NotificationService';
import { PrAddressHandler } from './PrAddressHandler';

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
  /** Auto-address output for PRs with new comments (when autoAddress is enabled) */
  readonly addressOutput?: readonly IAutoAddressOutput[];
}

/**
 * Auto-address output for a single PR.
 */
export interface IAutoAddressOutput {
  readonly prNumber: number;
  readonly repo: string;
  readonly formattedOutput: string;
}

interface IPrPollCacheEntry {
  readonly repo: string;
  readonly prNumber: number;
  readonly seenCommentIds: readonly string[];
  readonly lastState?: {
    readonly status: PullRequestStatus;
    readonly checksStatus: CheckStatus;
    readonly unresolvedComments: number;
  };
  readonly updatedAt: string;
}

interface IPrPollCache {
  readonly version: number;
  entries: Record<string, IPrPollCacheEntry>;
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
  /** Auto-address new comments by outputting formatted instructions (default: true) */
  readonly autoAddress?: boolean;
  /** Poll a specific PR number instead of watched PRs */
  readonly prNumber?: number;
  /** Repository for the target PR (owner/repo). Defaults to current repo. */
  readonly repo?: string;
  /** Use current PR from branch (foreground watch). */
  readonly current?: boolean;
  /** Use local cache for comment detection (no Neo4j). */
  readonly useLocalCache?: boolean;
}

/**
 * Handler for PR polling operations.
 */
export class PrPollHandler {
  private readonly logPath: string;
  private readonly cachePath: string;

  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository,
    private readonly notificationService?: INotificationService,
    private readonly memoryService?: IMemoryWriter
  ) {
    this.logPath = path.join(os.homedir(), '.lisa', 'pr-poll.log');
    this.cachePath = path.join(os.homedir(), '.lisa', 'pr-poll-cache.json');
  }

  /**
   * Poll all watched PRs for the current user.
   */
  async poll(options?: IPrPollOptions): Promise<IPrPollResult> {
    const polledAt = new Date().toISOString();
    const autoUnwatch = options?.autoUnwatch ?? true;
    const logToFile = options?.logToFile ?? true;
    const notify = options?.notify ?? false;
    const autoAddress = options?.autoAddress ?? true;
    const useLocalCache = options?.useLocalCache ?? false;
    // Guard against zero/negative concurrency to prevent infinite loops
    const concurrency = Math.max(1, options?.concurrency ?? 5);

    const logs: string[] = [];
    const log = (message: string) => {
      const entry = `[${new Date().toISOString()}] ${message}`;
      logs.push(entry);
    };

    try {
      const target = await this.resolveTarget(options);
      const localCache = useLocalCache ? await this.loadCache() : undefined;
      const needsUserId = !useLocalCache || !target;
      const userId = needsUserId
        ? await this.prRepository.getUserId()
        : undefined;

      let prsToPoll: readonly IPullRequest[] = [];

      if (target) {
        const existingPr = userId
          ? await this.prRepository.findPr(userId, target.repo, target.prNumber)
          : null;
        const cachedState = this.getCachedState(localCache, target.repo, target.prNumber);
        const fallbackPr = createPullRequest({
          number: target.prNumber,
          repo: target.repo,
          title: `PR #${target.prNumber}`,
          status: cachedState?.status,
          checksStatus: cachedState?.checksStatus,
          unresolvedComments: cachedState?.unresolvedComments,
        });
        prsToPoll = [existingPr ?? fallbackPr];
        log(`Polling ${target.repo}#${target.prNumber}...`);
      } else {
        // Query watched PRs (max 10 to avoid rate limiting)
        const MAX_WATCHED_PRS = 10;
        const { items: watchedPrs } = await this.prRepository.findWatchedPrs(userId as string, {
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
        prsToPoll = watchedPrs;
      }

      // Poll PRs with controlled concurrency
      const pollResults: IPrPollItem[] = [];
      const batches = this.batchArray(prsToPoll, concurrency);

      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(pr => this.pollSinglePr(pr, userId, autoUnwatch, log, {
            useLocalCache,
            localCache,
          }))
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

      // Auto-address PRs with new comments
      let addressOutput: IAutoAddressOutput[] | undefined;
      if (autoAddress) {
        const prsWithNewComments = pollResults.filter(item =>
          item.changes.some(c => c.type === 'new_comment' || c.type === 'new_reply')
        );

        if (prsWithNewComments.length > 0) {
          addressOutput = [];
          const addressHandler = new PrAddressHandler(this.githubClient, this.prRepository);

          for (const item of prsWithNewComments) {
            try {
              const addressResult = await addressHandler.execute({
                repo: item.repo,
                prNumber: item.number,
              });

              if (addressResult.commentsToAddress.length > 0) {
                addressOutput.push({
                  prNumber: item.number,
                  repo: item.repo,
                  formattedOutput: addressResult.formattedOutput,
                });
                log(`Auto-address: ${item.repo}#${item.number} has ${addressResult.commentsToAddress.length} comment(s) to address`);
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              log(`Auto-address failed for ${item.repo}#${item.number}: ${errMsg}`);
            }
          }
        }
      }

      log(`Poll complete. ${totalChanges} notification(s).`);

      // Write to log file
      let logPath: string | undefined;
      if (logToFile) {
        await this.writeLog(logs);
        logPath = this.logPath;
      }

      if (useLocalCache && localCache) {
        await this.writeCache(localCache);
      }

      return {
        success: totalErrors === 0,
        message: totalErrors > 0
          ? `Polled ${prsToPoll.length} PR(s) with ${totalErrors} error(s)`
          : `Polled ${prsToPoll.length} PR(s), ${totalChanges} change(s) detected`,
        polledAt,
        totalWatched: prsToPoll.length,
        totalChanges,
        totalErrors,
        items: pollResults,
        logPath,
        addressOutput: addressOutput && addressOutput.length > 0 ? addressOutput : undefined,
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
    userId: string | undefined,
    autoUnwatch: boolean,
    log: (message: string) => void,
    options?: {
      readonly useLocalCache?: boolean;
      readonly localCache?: IPrPollCache;
    }
  ): Promise<IPrPollItem> {
    const changes: IStateChange[] = [];
    let unwatched = false;
    let error: string | undefined;
    let resolvedTitle = pr.title;
    const useLocalCache = options?.useLocalCache ?? false;
    const localCache = options?.localCache;
    const cacheKey = useLocalCache ? this.getCacheKey(pr.repo, pr.number) : undefined;
    const cacheEntry = cacheKey && localCache ? localCache.entries[cacheKey] : undefined;

    let previousState = {
      status: cacheEntry?.lastState?.status ?? pr.status,
      checksStatus: cacheEntry?.lastState?.checksStatus ?? pr.checksStatus,
      unresolvedComments: cacheEntry?.lastState?.unresolvedComments ?? pr.unresolvedComments,
    };

    let currentState = { ...previousState };

    try {
      // Fetch current state from GitHub
      const ghPr = await this.githubClient.getPr(pr.repo, pr.number);
      resolvedTitle = ghPr.title;
      const ghChecks = await this.githubClient.getPrChecks(pr.repo, pr.number);
      const ghComments = await this.githubClient.getPrComments(pr.repo, pr.number);
      let reviewThreads: readonly IGhReviewThreadResponse[] | undefined;
      if (useLocalCache) {
        try {
          reviewThreads = await this.githubClient.getPrReviewThreads(pr.repo, pr.number);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log(`${pr.repo}#${pr.number}: failed to fetch review threads: ${errMsg}`);
        }
      }

      // Map GitHub state to domain
      const newStatus = this.mapPrStatus(ghPr.state);
      const newChecksStatus = this.calculateOverallCheckStatus(ghChecks);
      const newUnresolvedComments = reviewThreads
        ? this.countUnresolvedThreads(reviewThreads)
        : this.countUnresolvedComments(ghComments);

      currentState = {
        status: newStatus,
        checksStatus: newChecksStatus,
        unresolvedComments: newUnresolvedComments,
      };

      if (useLocalCache && !cacheEntry?.lastState) {
        previousState = { ...currentState };
      }

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

          // Auto-capture merged PR to memory
          if (this.memoryService) {
            try {
              const fact = `PR MERGED: #${pr.number} ${ghPr.title}`;
              const tags = ['github:pr', 'github:pr-merged', `github:pr:${pr.number}`];
              await this.memoryService.addFact(fact, tags);
              log(`${pr.repo}#${pr.number}: saved to memory`);
            } catch (memError) {
              // Don't fail the poll if memory save fails
              log(`${pr.repo}#${pr.number}: failed to save to memory: ${memError instanceof Error ? memError.message : String(memError)}`);
            }
          }
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
      if (useLocalCache) {
        const seenIds = new Set(cacheEntry?.seenCommentIds ?? []);
        const newCommentChanges = this.detectNewCommentsFromCache(pr, ghComments, seenIds, log);
        changes.push(...newCommentChanges);

        if (cacheKey && localCache) {
          const updatedSeenIds = new Set(seenIds);
          for (const comment of ghComments) {
            updatedSeenIds.add(String(comment.id));
          }
          localCache.entries[cacheKey] = {
            repo: pr.repo,
            prNumber: pr.number,
            seenCommentIds: Array.from(updatedSeenIds),
            lastState: currentState,
            updatedAt: new Date().toISOString(),
          };
        }
      } else if (userId) {
        const previousComments = await this.prRepository.findCommentsByPr(userId, pr.repo, pr.number);
        const newCommentChanges = await this.detectNewComments(
          pr,
          previousComments,
          ghComments,
          userId,
          log
        );
        changes.push(...newCommentChanges);

        // Check for comment resolution changes via GraphQL review threads
        const resolutionChanges = await this.detectCommentResolution(
          pr,
          previousComments,
          userId,
          log
        );
        changes.push(...resolutionChanges);

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
      title: resolvedTitle,
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
   * Detect comment resolution changes via GraphQL review threads.
   * Updates stored comments and returns state changes for newly resolved threads.
   */
  private async detectCommentResolution(
    pr: IPullRequest,
    previousComments: readonly IPrComment[],
    userId: string,
    log: (message: string) => void
  ): Promise<IStateChange[]> {
    const changes: IStateChange[] = [];

    try {
      // Fetch review threads with resolution status from GraphQL
      const reviewThreads = await this.githubClient.getPrReviewThreads(pr.repo, pr.number);

      // Build a map of comment database IDs to resolution status
      const threadResolutionMap = new Map<string, boolean>();
      for (const thread of reviewThreads) {
        for (const comment of thread.comments.nodes) {
          // Use databaseId which matches the REST API id
          threadResolutionMap.set(String(comment.databaseId), thread.isResolved);
        }
      }

      // Check each stored comment for resolution status changes
      let resolvedCount = 0;
      let unresolvedCount = 0;
      for (const comment of previousComments) {
        const isNowResolved = threadResolutionMap.get(comment.commentId);
        
        // If the comment was pending/addressed but is now resolved, update it
        if (isNowResolved === true && comment.status !== 'resolved') {
          resolvedCount++;
          
          // Update the comment status in Neo4j
          await this.prRepository.upsertComment(userId, pr.repo, pr.number, {
            ...comment,
            status: 'resolved',
          });

          log(`${pr.repo}#${pr.number}: comment ${comment.commentId} resolved`);
        }
        // If the comment was resolved but is now un-resolved (reviewer reopened), update it
        else if (isNowResolved === false && comment.status === 'resolved') {
          unresolvedCount++;
          
          // Reset to addressed (we had replied) or pending
          const newStatus = comment.ourReplyId ? 'addressed' : 'pending';
          await this.prRepository.upsertComment(userId, pr.repo, pr.number, {
            ...comment,
            status: newStatus,
          });

          log(`${pr.repo}#${pr.number}: comment ${comment.commentId} un-resolved → ${newStatus}`);
        }
      }

      // If any comments were resolved, create a state change
      if (resolvedCount > 0) {
        const change: IStateChange = {
          type: 'comment_resolved',
          description: `${resolvedCount} comment${resolvedCount > 1 ? 's' : ''} resolved`,
          prNumber: pr.number,
          repo: pr.repo,
        };
        changes.push(change);

        // Check if ALL comments are now resolved
        const remainingUnresolved = previousComments.filter(
          c => c.status !== 'resolved' && threadResolutionMap.get(c.commentId) !== true
        ).length;

        if (remainingUnresolved === 0 && previousComments.length > 0) {
          log(`${pr.repo}#${pr.number}: all comments resolved! 🎉`);
        }
      }

      // If any comments were un-resolved, notify (needs attention!)
      if (unresolvedCount > 0) {
        const change: IStateChange = {
          type: 'new_comment', // Reuse new_comment type since it needs attention
          description: `${unresolvedCount} comment${unresolvedCount > 1 ? 's' : ''} re-opened by reviewer`,
          prNumber: pr.number,
          repo: pr.repo,
        };
        changes.push(change);
      }
    } catch (err) {
      // GraphQL query failed - log but don't fail the poll
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`${pr.repo}#${pr.number}: failed to check comment resolution: ${errorMsg}`);
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

  private async resolveTarget(options?: IPrPollOptions): Promise<{ repo: string; prNumber: number } | undefined> {
    if (!options?.prNumber && !options?.current) {
      return undefined;
    }

    if (options.prNumber && options.current) {
      throw new Error('Cannot use both prNumber and current');
    }

    const repo = options.repo ?? await this.githubClient.getCurrentRepo();
    const prNumber = options.prNumber ?? await this.githubClient.getCurrentPrNumber();
    return { repo, prNumber };
  }

  private getCacheKey(repo: string, prNumber: number): string {
    return `${repo}#${prNumber}`;
  }

  private getCachedState(
    localCache: IPrPollCache | undefined,
    repo: string,
    prNumber: number
  ): IPrPollCacheEntry['lastState'] | undefined {
    if (!localCache) {
      return undefined;
    }
    const key = this.getCacheKey(repo, prNumber);
    return localCache.entries[key]?.lastState;
  }

  private async loadCache(): Promise<IPrPollCache> {
    try {
      if (!(await fs.pathExists(this.cachePath))) {
        return { version: 1, entries: {} };
      }
      const raw = await fs.readFile(this.cachePath, 'utf8');
      const parsed = JSON.parse(raw) as IPrPollCache;
      if (!parsed.entries || typeof parsed.entries !== 'object') {
        return { version: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private async writeCache(cache: IPrPollCache): Promise<void> {
    try {
      const cacheDir = path.dirname(this.cachePath);
      await fs.ensureDir(cacheDir);
      await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2));
    } catch {
      // Silently ignore cache write failures
    }
  }

  private countUnresolvedThreads(reviewThreads: readonly IGhReviewThreadResponse[]): number {
    return reviewThreads.filter(thread => !thread.isResolved).length;
  }

  private detectNewCommentsFromCache(
    pr: IPullRequest,
    ghComments: readonly IGhReviewCommentResponse[],
    seenIds: Set<string>,
    log: (message: string) => void
  ): IStateChange[] {
    const changes: IStateChange[] = [];

    for (const ghComment of ghComments) {
      const commentId = String(ghComment.id);
      if (seenIds.has(commentId)) {
        continue;
      }

      const isReply = Boolean(ghComment.in_reply_to_id);
      const change: IStateChange = {
        type: 'new_comment',
        description: `new ${isReply ? 'reply' : 'comment'} from @${ghComment.user.login} on ${ghComment.path}:${ghComment.line || ghComment.original_line || '?'}`,
        prNumber: pr.number,
        repo: pr.repo,
      };
      changes.push(change);
      log(`${pr.repo}#${pr.number}: ${change.description}`);
    }

    return changes;
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
