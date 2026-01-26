/**
 * PR Checks Handler
 *
 * Fetches and displays CI check status for a PR.
 * Uses GithubClient to get real-time check status from GitHub.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import type { IGithubClient } from '../../../domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../domain/interfaces/dal/IPullRequestRepository';
import type { CheckStatus } from '../../../domain/interfaces/types/IPullRequest';

/**
 * Result from PrChecksHandler.
 */
export interface IPrChecksResult {
  readonly repo: string;
  readonly prNumber: number;
  readonly title?: string;
  readonly overallStatus: CheckStatus;
  readonly checks: readonly {
    readonly name: string;
    readonly status: CheckStatus;
    readonly conclusion?: string;
    readonly detailsUrl?: string;
  }[];
  readonly summary: string;
}

/**
 * Options for PrChecksHandler.
 */
export interface IPrChecksOptions {
  readonly repo?: string;  // If not provided, uses current repo
  readonly prNumber: number;
  readonly saveToNeo4j?: boolean;  // Default: true
}

/**
 * Handler for fetching PR check status.
 */
export class PrChecksHandler {
  constructor(
    private readonly githubClient: IGithubClient,
    private readonly prRepository: IPullRequestRepository
  ) {}

  /**
   * Get CI check status for a PR.
   */
  async execute(options: IPrChecksOptions): Promise<IPrChecksResult> {
    // Resolve repo
    const repo = options.repo || await this.githubClient.getCurrentRepo();

    // Fetch PR details for title
    let title: string | undefined;
    try {
      const pr = await this.githubClient.getPr(repo, options.prNumber);
      title = pr.title;
    } catch {
      // PR might not exist, but we'll try to get checks anyway
    }

    // Fetch checks from GitHub
    const ghChecks = await this.githubClient.getPrChecks(repo, options.prNumber);

    // Map to our domain types
    const checks = ghChecks.map(check => ({
      name: check.name,
      status: this.mapCheckStatus(check.state),
      conclusion: check.conclusion,
      detailsUrl: check.detailsUrl,
    }));

    // Calculate overall status
    const overallStatus = this.calculateOverallStatus(checks);

    // Optionally save to Neo4j
    if (options.saveToNeo4j !== false) {
      await this.saveChecksToNeo4j(repo, options.prNumber, checks);
    }

    // Generate summary
    const summary = this.generateSummary(checks, overallStatus);

    return {
      repo,
      prNumber: options.prNumber,
      title,
      overallStatus,
      checks,
      summary,
    };
  }

  /**
   * Map GitHub check state to domain CheckStatus.
   */
  private mapCheckStatus(
    state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'CANCELLED' | 'QUEUED' | 'IN_PROGRESS'
  ): CheckStatus {
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
   * Calculate overall status from individual checks.
   */
  private calculateOverallStatus(
    checks: readonly { readonly status: CheckStatus }[]
  ): CheckStatus {
    if (checks.length === 0) {
      return 'pending';
    }

    // Any failure = overall failure
    if (checks.some(c => c.status === 'failure')) {
      return 'failure';
    }

    // Any cancelled = overall cancelled
    if (checks.some(c => c.status === 'cancelled')) {
      return 'cancelled';
    }

    // Any pending = overall pending
    if (checks.some(c => c.status === 'pending')) {
      return 'pending';
    }

    // All success/skipped = overall success
    return 'success';
  }

  /**
   * Save checks to Neo4j via repository.
   */
  private async saveChecksToNeo4j(
    repo: string,
    prNumber: number,
    checks: readonly { readonly name: string; readonly status: CheckStatus; readonly conclusion?: string; readonly detailsUrl?: string }[]
  ): Promise<void> {
    try {
      const userId = await this.prRepository.getUserId();

      for (const check of checks) {
        await this.prRepository.upsertCheck(userId, repo, prNumber, {
          checkName: check.name,
          status: check.status,
          conclusion: check.conclusion,
          detailsUrl: check.detailsUrl,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Non-fatal: checks are informational
    }
  }

  /**
   * Generate human-readable summary.
   */
  private generateSummary(
    checks: readonly { readonly name: string; readonly status: CheckStatus }[],
    overallStatus: CheckStatus
  ): string {
    if (checks.length === 0) {
      return 'No checks found';
    }

    const passed = checks.filter(c => c.status === 'success').length;
    const failed = checks.filter(c => c.status === 'failure').length;
    const pending = checks.filter(c => c.status === 'pending').length;
    const skipped = checks.filter(c => c.status === 'skipped' || c.status === 'cancelled').length;

    const parts: string[] = [];
    if (passed > 0) parts.push(`${passed} passed`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (pending > 0) parts.push(`${pending} pending`);
    if (skipped > 0) parts.push(`${skipped} skipped`);

    const statusEmoji = {
      success: '✅',
      failure: '❌',
      pending: '⏳',
      cancelled: '⚪',
      skipped: '⚪',
    };

    return `${statusEmoji[overallStatus]} ${parts.join(', ')}`;
  }
}
