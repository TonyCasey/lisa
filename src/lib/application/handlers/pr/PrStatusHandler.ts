/**
 * PR Status Handler
 *
 * Provides a multi-PR summary dashboard showing all watched PRs
 * grouped by repository with status indicators.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { IPullRequest, CheckStatus } from '../../../domain/interfaces/types/IPullRequest';

/**
 * Ready state for a PR.
 */
export type ReadyState = 'ready' | 'blocked' | 'draft' | 'merged' | 'closed' | 'pending';

/**
 * PR status item with ready-for-merge analysis.
 */
export interface IPrStatusItem {
  readonly number: number;
  readonly repo: string;
  readonly title: string;
  readonly status: 'open' | 'merged' | 'closed';
  readonly isDraft: boolean;
  readonly checksStatus: CheckStatus;
  readonly checksTotal: number;
  readonly checksPassed: number;
  readonly unresolvedComments: number;
  readonly hasApproval: boolean;
  readonly readyState: ReadyState;
  readonly lastPolled?: string;
}

/**
 * PRs grouped by repository.
 */
export interface IPrsByRepo {
  readonly repo: string;
  readonly prs: readonly IPrStatusItem[];
}

/**
 * Summary counts.
 */
export interface IPrStatusSummary {
  readonly total: number;
  readonly ready: number;
  readonly blocked: number;
  readonly draft: number;
  readonly merged: number;
  readonly closed: number;
  readonly pending: number;
}

/**
 * Result from PrStatusHandler.
 */
export interface IPrStatusResult {
  readonly success: boolean;
  readonly message: string;
  readonly user: string;
  readonly byRepo: readonly IPrsByRepo[];
  readonly summary: IPrStatusSummary;
  readonly formattedOutput: string;
}

/**
 * Options for status command.
 */
export interface IPrStatusOptions {
  readonly repo?: string;  // Filter by repository
}

/**
 * Handler for PR status summary.
 */
export class PrStatusHandler {
  constructor(
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Get status summary of all watched PRs.
   */
  async execute(options?: IPrStatusOptions): Promise<IPrStatusResult> {
    try {
      const userId = await this.prRepository.getUserId();
      const shortUser = this.formatUserId(userId);

      // Fetch all watched PRs
      const result = await this.prRepository.findWatchedPrs(userId, {
        repo: options?.repo,
        limit: 50, // Reasonable limit for dashboard
      });

      if (result.items.length === 0) {
        return {
          success: true,
          message: 'No PRs being watched',
          user: shortUser,
          byRepo: [],
          summary: this.createEmptySummary(),
          formattedOutput: this.formatNoResults(shortUser, options?.repo),
        };
      }

      // Convert to status items with ready-state analysis
      const statusItems = result.items.map(pr => this.toStatusItem(pr));

      // Group by repository
      const byRepo = this.groupByRepo(statusItems);

      // Sort repos alphabetically, PRs by priority (needs attention first)
      const sortedByRepo = this.sortByPriority(byRepo);

      // Calculate summary
      const summary = this.calculateSummary(statusItems);

      // Format output
      const formattedOutput = this.formatOutput(shortUser, sortedByRepo, summary);

      return {
        success: true,
        message: `${result.items.length} PR(s) watched`,
        user: shortUser,
        byRepo: sortedByRepo,
        summary,
        formattedOutput,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to get PR status: ${message}`,
        user: '',
        byRepo: [],
        summary: this.createEmptySummary(),
        formattedOutput: '',
      };
    }
  }

  /**
   * Convert IPullRequest to IPrStatusItem with ready-state analysis.
   */
  private toStatusItem(pr: IPullRequest): IPrStatusItem {
    // For now, we don't have draft status in the PR entity
    // We'll assume non-draft unless we extend the type later
    const isDraft = false;
    
    // Determine ready state based on criteria
    const readyState = this.determineReadyState(pr, isDraft);

    // We don't have check counts stored yet, so estimate from status
    const checksTotal = 1; // placeholder
    const checksPassed = pr.checksStatus === 'success' ? 1 : 0;

    // We don't have approval status stored yet
    const hasApproval = false; // placeholder - would need GitHub API call

    return {
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      status: pr.status,
      isDraft,
      checksStatus: pr.checksStatus,
      checksTotal,
      checksPassed,
      unresolvedComments: pr.unresolvedComments,
      hasApproval,
      readyState,
      lastPolled: pr.lastPolled,
    };
  }

  /**
   * Determine ready-for-merge state.
   * 
   * Ready when:
   * - Status is open (not draft, not merged, not closed)
   * - All checks passed
   * - No unresolved comments
   * - Has at least one approval (if required)
   */
  private determineReadyState(pr: IPullRequest, isDraft: boolean): ReadyState {
    // Handle non-open states first
    if (pr.status === 'merged') return 'merged';
    if (pr.status === 'closed') return 'closed';
    if (isDraft) return 'draft';

    // Check blocking conditions
    if (pr.checksStatus === 'failure') return 'blocked';
    if (pr.checksStatus === 'pending') return 'pending';
    if (pr.unresolvedComments > 0) return 'blocked';

    // All checks passed, no unresolved comments
    if (pr.checksStatus === 'success') return 'ready';

    // Default to pending for unknown states
    return 'pending';
  }

  /**
   * Group PRs by repository.
   */
  private groupByRepo(items: IPrStatusItem[]): IPrsByRepo[] {
    const grouped = new Map<string, IPrStatusItem[]>();

    for (const item of items) {
      const existing = grouped.get(item.repo) || [];
      grouped.set(item.repo, [...existing, item]);
    }

    return Array.from(grouped.entries()).map(([repo, prs]) => ({
      repo,
      prs,
    }));
  }

  /**
   * Sort repos alphabetically, PRs by priority.
   * Priority: blocked > pending > ready > draft > merged > closed
   */
  private sortByPriority(byRepo: IPrsByRepo[]): IPrsByRepo[] {
    const statePriority: Record<ReadyState, number> = {
      blocked: 0,
      pending: 1,
      ready: 2,
      draft: 3,
      merged: 4,
      closed: 5,
    };

    return byRepo
      .map(group => ({
        ...group,
        prs: [...group.prs].sort((a, b) => {
          const priorityDiff = statePriority[a.readyState] - statePriority[b.readyState];
          if (priorityDiff !== 0) return priorityDiff;
          // Secondary sort by PR number descending (newer first)
          return b.number - a.number;
        }),
      }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
  }

  /**
   * Calculate summary counts.
   */
  private calculateSummary(items: IPrStatusItem[]): IPrStatusSummary {
    let ready = 0;
    let blocked = 0;
    let draft = 0;
    let merged = 0;
    let closed = 0;
    let pending = 0;

    for (const item of items) {
      switch (item.readyState) {
        case 'ready': ready++; break;
        case 'blocked': blocked++; break;
        case 'draft': draft++; break;
        case 'merged': merged++; break;
        case 'closed': closed++; break;
        case 'pending': pending++; break;
      }
    }

    return {
      total: items.length,
      ready,
      blocked,
      draft,
      merged,
      closed,
      pending,
    };
  }

  /**
   * Create empty summary.
   */
  private createEmptySummary(): IPrStatusSummary {
    return {
      total: 0,
      ready: 0,
      blocked: 0,
      draft: 0,
      merged: 0,
      closed: 0,
      pending: 0,
    };
  }

  /**
   * Format user ID for display (extract username from group_id).
   */
  private formatUserId(userId: string): string {
    // userId is like "user:tonycasey"
    return userId.replace(/^user:/, '');
  }

  /**
   * Format output when no results.
   */
  private formatNoResults(user: string, repoFilter?: string): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(`PR Status Summary (user:${user})`);
    lines.push('═'.repeat(76));
    lines.push('');
    if (repoFilter) {
      lines.push(`No PRs being watched in ${repoFilter}`);
    } else {
      lines.push('No PRs being watched');
    }
    lines.push('');
    lines.push('Use `lisa pr watch <number>` to start tracking PRs.');
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Format the full status output.
   */
  private formatOutput(
    user: string,
    byRepo: readonly IPrsByRepo[],
    summary: IPrStatusSummary
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(`PR Status Summary (user:${user})`);
    lines.push('═'.repeat(76));
    lines.push('');

    // Each repo
    for (const group of byRepo) {
      lines.push(` ${group.repo}`);
      lines.push(' ' + '─'.repeat(74));

      for (const pr of group.prs) {
        lines.push(this.formatPrLine(pr));
      }
      lines.push('');
    }

    // Footer
    lines.push('═'.repeat(76));
    lines.push(this.formatSummaryLine(summary));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format a single PR line.
   */
  private formatPrLine(pr: IPrStatusItem): string {
    // Status indicator
    const statusIcon = this.getStatusIcon(pr.status);

    // Checks indicator
    const checksIcon = this.getChecksIcon(pr.checksStatus);
    const checksText = `${pr.checksPassed}/${pr.checksTotal}`;

    // Comments
    const commentsText = pr.unresolvedComments > 0 
      ? `${pr.unresolvedComments} comment${pr.unresolvedComments > 1 ? 's' : ''}`
      : '0 comments';

    // Ready state
    const readyIcon = this.getReadyIcon(pr.readyState);

    // Truncate title
    const maxTitleLen = 28;
    const title = pr.title.length > maxTitleLen
      ? pr.title.substring(0, maxTitleLen - 1) + '…'
      : pr.title.padEnd(maxTitleLen);

    // Format: " #28  Add memory feature           open     ✅ 3/3   2 comments   🟢 Ready"
    const prNum = `#${pr.number}`.padEnd(5);
    const status = pr.status.padEnd(8);
    const checks = `${checksIcon} ${checksText}`.padEnd(8);
    const comments = commentsText.padEnd(13);
    const ready = `${readyIcon} ${this.capitalizeFirst(pr.readyState)}`;

    return ` ${prNum} ${title} ${status} ${checks} ${comments} ${ready}`;
  }

  /**
   * Format summary line.
   */
  private formatSummaryLine(summary: IPrStatusSummary): string {
    const parts: string[] = [`Summary: ${summary.total} PR${summary.total !== 1 ? 's' : ''} watched`];

    if (summary.ready > 0) parts.push(`${summary.ready} ready`);
    if (summary.blocked > 0) parts.push(`${summary.blocked} blocked`);
    if (summary.pending > 0) parts.push(`${summary.pending} pending`);
    if (summary.draft > 0) parts.push(`${summary.draft} draft`);
    if (summary.merged > 0) parts.push(`${summary.merged} merged`);
    if (summary.closed > 0) parts.push(`${summary.closed} closed`);

    return parts.join(' | ');
  }

  /**
   * Get status icon for PR state.
   */
  private getStatusIcon(status: 'open' | 'merged' | 'closed'): string {
    switch (status) {
      case 'open': return '🟢';
      case 'merged': return '🟣';
      case 'closed': return '⚪';
    }
  }

  /**
   * Get checks icon.
   */
  private getChecksIcon(status: CheckStatus): string {
    switch (status) {
      case 'success': return '✅';
      case 'failure': return '❌';
      case 'pending': return '⏳';
      case 'cancelled': return '⚪';
      case 'skipped': return '⚪';
    }
  }

  /**
   * Get ready state icon.
   */
  private getReadyIcon(state: ReadyState): string {
    switch (state) {
      case 'ready': return '🟢';
      case 'blocked': return '🔴';
      case 'pending': return '🟡';
      case 'draft': return '⚪';
      case 'merged': return '🟣';
      case 'closed': return '⚪';
    }
  }

  /**
   * Capitalize first letter.
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
