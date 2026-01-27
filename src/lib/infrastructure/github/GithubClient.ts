/**
 * GitHub CLI Wrapper
 *
 * Wraps the `gh` CLI to provide a clean TypeScript interface for GitHub API operations.
 * Uses the existing `gh` authentication and handles rate limiting automatically.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import { execSync, execFileSync, spawnSync } from 'child_process';
import type {
  IGhPrResponse,
  IGhCheckResponse,
  IGhReviewResponse,
  IGhReviewCommentResponse,
  IGhIssueResponse,
  IGhUserResponse,
  IGithubClientOptions,
} from './types';
import { GithubClientError } from './types';

/**
 * Default options for GithubClient.
 */
const DEFAULT_OPTIONS: Required<IGithubClientOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30000,
};

/**
 * GitHub CLI wrapper for PR operations.
 */
export class GithubClient {
  private readonly options: Required<IGithubClientOptions>;
  private cachedUser: IGhUserResponse | null = null;

  constructor(options?: IGithubClientOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ============================================================
  // Core Execution
  // ============================================================

  /**
   * Execute a gh CLI command and parse JSON output.
   * Uses spawnSync with shell: false to avoid shell injection.
   */
  private async execGh<T>(args: string[], parseJson = true): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = spawnSync('gh', args, {
          encoding: 'utf-8',
          timeout: this.options.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB for large PR diffs
          shell: false, // Critical: avoid shell interpolation
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          const errorMessage = result.stderr || result.stdout || 'Unknown error';
          throw new Error(errorMessage);
        }

        const output = result.stdout.trim();
        if (parseJson) {
          return JSON.parse(output) as T;
        }
        return output as unknown as T;
      } catch (error) {
        lastError = error as Error;
        const errorMessage = (error as Error).message || '';

        // Check for specific error types
        if (errorMessage.includes('ENOENT') || errorMessage.includes('gh: command not found') || errorMessage.includes('is not recognized')) {
          throw new GithubClientError(
            'GitHub CLI (gh) is not installed. Install from https://cli.github.com/',
            'NOT_INSTALLED',
            lastError
          );
        }

        if (errorMessage.includes('not logged in') || errorMessage.includes('authentication')) {
          throw new GithubClientError(
            'GitHub CLI is not authenticated. Run: gh auth login',
            'NOT_AUTHENTICATED',
            lastError
          );
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('API rate limit')) {
          if (attempt < this.options.maxRetries) {
            await this.delay(this.options.retryDelayMs * (attempt + 1));
            continue;
          }
          throw new GithubClientError(
            'GitHub API rate limit exceeded. Try again later.',
            'RATE_LIMITED',
            lastError
          );
        }

        if (errorMessage.includes('Could not resolve') || errorMessage.includes('not found') || errorMessage.includes('404')) {
          throw new GithubClientError(
            `Resource not found: ${args.join(' ')}`,
            'NOT_FOUND',
            lastError
          );
        }

        // Retry on transient errors
        if (attempt < this.options.maxRetries) {
          await this.delay(this.options.retryDelayMs * (attempt + 1));
          continue;
        }
      }
    }

    throw new GithubClientError(
      `GitHub CLI command failed: gh ${args.join(' ')}`,
      'UNKNOWN',
      lastError
    );
  }

  /**
   * Execute a gh api command.
   * Uses stdin for POST data to avoid shell injection vulnerabilities.
   */
  private async execGhApi<T>(endpoint: string, method = 'GET', data?: Record<string, string>): Promise<T> {
    // Build args array to avoid shell interpolation
    const args = ['api', endpoint];

    if (method !== 'GET') {
      args.push('-X', method);
    }

    // For data payloads, use --input - to pass JSON via stdin (avoids shell injection)
    if (data) {
      args.push('--input', '-');
      return this.execGhWithStdin<T>(args, JSON.stringify(data));
    }

    return this.execGh<T>(args);
  }

  /**
   * Execute a gh CLI command with stdin input.
   * Uses spawnSync with shell: false to avoid shell injection.
   */
  private async execGhWithStdin<T>(args: string[], input: string, parseJson = true): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = spawnSync('gh', args, {
          encoding: 'utf-8',
          input,
          timeout: this.options.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB for large responses
          shell: false, // Critical: avoid shell interpolation
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          const errorMessage = result.stderr || result.stdout || 'Unknown error';
          throw new Error(errorMessage);
        }

        const output = result.stdout.trim();
        if (parseJson) {
          return JSON.parse(output) as T;
        }
        return output as unknown as T;
      } catch (error) {
        lastError = error as Error;
        const errorMessage = (error as Error).message || '';

        // Check for specific error types
        if (errorMessage.includes('ENOENT') || errorMessage.includes('gh: command not found')) {
          throw new GithubClientError(
            'GitHub CLI (gh) is not installed. Install from https://cli.github.com/',
            'NOT_INSTALLED',
            lastError
          );
        }

        if (errorMessage.includes('not logged in') || errorMessage.includes('authentication')) {
          throw new GithubClientError(
            'GitHub CLI is not authenticated. Run: gh auth login',
            'NOT_AUTHENTICATED',
            lastError
          );
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('API rate limit')) {
          if (attempt < this.options.maxRetries) {
            await this.delay(this.options.retryDelayMs * (attempt + 1));
            continue;
          }
          throw new GithubClientError(
            'GitHub API rate limit exceeded. Try again later.',
            'RATE_LIMITED',
            lastError
          );
        }

        if (errorMessage.includes('Could not resolve') || errorMessage.includes('not found') || errorMessage.includes('404')) {
          throw new GithubClientError(
            `Resource not found: ${args.join(' ')}`,
            'NOT_FOUND',
            lastError
          );
        }

        // Retry on transient errors
        if (attempt < this.options.maxRetries) {
          await this.delay(this.options.retryDelayMs * (attempt + 1));
          continue;
        }
      }
    }

    throw new GithubClientError(
      `GitHub CLI command failed: gh ${args.join(' ')}`,
      'UNKNOWN',
      lastError
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // PR Operations
  // ============================================================

  /**
   * Get PR details.
   */
  async getPr(repo: string, prNumber: number): Promise<IGhPrResponse> {
    const fields = [
      'number',
      'title',
      'state',
      'body',
      'headRefName',
      'baseRefName',
      'url',
      'isDraft',
      'mergeable',
      'createdAt',
      'updatedAt',
      'closingIssuesReferences',
      'author',
      'headRepository',
    ].join(',');

    return this.execGh<IGhPrResponse>(['pr', 'view', String(prNumber), '--repo', repo, '--json', fields]);
  }

  /**
   * Get CI check statuses for a PR.
   * Note: Returns empty array only when PR exists but has no checks.
   * Throws NOT_FOUND if the PR itself doesn't exist.
   */
  async getPrChecks(repo: string, prNumber: number): Promise<readonly IGhCheckResponse[]> {
    const fields = ['name', 'state', 'conclusion', 'detailsUrl', 'startedAt', 'completedAt'].join(',');

    try {
      return await this.execGh<IGhCheckResponse[]>(['pr', 'checks', String(prNumber), '--repo', repo, '--json', fields]);
    } catch (error) {
      if (error instanceof GithubClientError && error.code === 'NOT_FOUND') {
        // Distinguish between "PR not found" vs "PR has no checks"
        // by verifying the PR exists first
        try {
          await this.getPr(repo, prNumber);
          // PR exists but has no checks - return empty array
          return [];
        } catch (prError) {
          // PR itself doesn't exist - propagate the NOT_FOUND error
          throw error;
        }
      }
      throw error;
    }
  }

  /**
   * Get PR reviews.
   */
  async getPrReviews(repo: string, prNumber: number): Promise<readonly IGhReviewResponse[]> {
    const [owner, repoName] = repo.split('/');
    return this.execGhApi<IGhReviewResponse[]>(`repos/${owner}/${repoName}/pulls/${prNumber}/reviews`);
  }

  /**
   * Get PR review comments (inline comments on diff).
   */
  async getPrComments(repo: string, prNumber: number): Promise<readonly IGhReviewCommentResponse[]> {
    const [owner, repoName] = repo.split('/');
    return this.execGhApi<IGhReviewCommentResponse[]>(`repos/${owner}/${repoName}/pulls/${prNumber}/comments`);
  }

  /**
   * Get the diff for a PR.
   */
  async getPrDiff(repo: string, prNumber: number): Promise<string> {
    return this.execGh<string>(['pr', 'diff', String(prNumber), '--repo', repo], false);
  }

  // ============================================================
  // Issue Operations
  // ============================================================

  /**
   * Get issue details.
   */
  async getIssue(repo: string, issueNumber: number): Promise<IGhIssueResponse> {
    const fields = [
      'number',
      'title',
      'state',
      'body',
      'url',
      'createdAt',
      'updatedAt',
      'labels',
      'author',
    ].join(',');

    return this.execGh<IGhIssueResponse>(['issue', 'view', String(issueNumber), '--repo', repo, '--json', fields]);
  }

  // ============================================================
  // Comment Operations
  // ============================================================

  /**
   * Reply to a PR review comment.
   */
  async replyToComment(repo: string, commentId: number, body: string): Promise<IGhReviewCommentResponse> {
    const [owner, repoName] = repo.split('/');
    return this.execGhApi<IGhReviewCommentResponse>(
      `repos/${owner}/${repoName}/pulls/comments/${commentId}/replies`,
      'POST',
      { body }
    );
  }

  /**
   * Add a reaction to a PR comment.
   * @param reaction - One of: +1, -1, laugh, confused, heart, hooray, rocket, eyes
   */
  async addReaction(
    repo: string,
    commentId: number,
    reaction: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'
  ): Promise<void> {
    const [owner, repoName] = repo.split('/');
    await this.execGhApi(
      `repos/${owner}/${repoName}/pulls/comments/${commentId}/reactions`,
      'POST',
      { content: reaction }
    );
  }

  // ============================================================
  // User Operations
  // ============================================================

  /**
   * Get the currently authenticated GitHub user.
   * Cached after first call.
   */
  async getCurrentUser(): Promise<IGhUserResponse> {
    if (this.cachedUser) {
      return this.cachedUser;
    }

    this.cachedUser = await this.execGhApi<IGhUserResponse>('user');
    return this.cachedUser;
  }

  /**
   * Get the user ID in Lisa's format for user-scoped storage.
   * Returns format: "user:<github-username>"
   */
  async getUserId(): Promise<string> {
    const user = await this.getCurrentUser();
    return `user:${user.login.toLowerCase()}`;
  }

  // ============================================================
  // Repository Operations
  // ============================================================

  /**
   * Get the current repository from git remote.
   * Returns format: "owner/repo"
   */
  async getCurrentRepo(): Promise<string> {
    try {
      const output = execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', {
        encoding: 'utf-8',
        timeout: this.options.timeoutMs,
      });
      return output.trim();
    } catch {
      // Fallback to git remote parsing
      try {
        const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
        // Parse SSH format: git@github.com:owner/repo.git
        const sshMatch = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
        if (sshMatch) {
          return sshMatch[1];
        }
        // Parse HTTPS format: https://github.com/owner/repo.git
        const httpsMatch = remote.match(/github\.com\/(.+?)(?:\.git)?$/);
        if (httpsMatch) {
          return httpsMatch[1];
        }
      } catch {
        // Ignore git errors
      }
      throw new GithubClientError(
        'Could not determine current repository',
        'UNKNOWN'
      );
    }
  }

  // ============================================================
  // Git Operations
  // ============================================================

  /**
   * Get the current git branch name.
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const output = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        timeout: this.options.timeoutMs,
      });
      return output.trim();
    } catch {
      throw new GithubClientError(
        'Could not determine current branch. Are you in a git repository?',
        'UNKNOWN'
      );
    }
  }

  /**
   * Get the default branch for a repository (usually main or master).
   */
  async getDefaultBranch(repo: string): Promise<string> {
    try {
      const result = await this.execGh<{ defaultBranchRef: { name: string } }>(
        ['repo', 'view', repo, '--json', 'defaultBranchRef']
      );
      return result.defaultBranchRef.name;
    } catch {
      // Fallback: try common names (main, master, develop)
      try {
        execSync('git rev-parse --verify origin/main', { encoding: 'utf-8', stdio: 'pipe' });
        return 'main';
      } catch {
        try {
          execSync('git rev-parse --verify origin/master', { encoding: 'utf-8', stdio: 'pipe' });
          return 'master';
        } catch {
          try {
            execSync('git rev-parse --verify origin/develop', { encoding: 'utf-8', stdio: 'pipe' });
            return 'develop';
          } catch {
            return 'main'; // Default assumption
          }
        }
      }
    }
  }

  /**
   * Get commit messages between base and head (or HEAD if not specified).
   */
  async getCommitMessages(base: string, head = 'HEAD'): Promise<readonly string[]> {
    try {
      const output = execFileSync('git', ['log', `${base}..${head}`, '--pretty=format:%s'], {
        encoding: 'utf-8',
        timeout: this.options.timeoutMs,
      });
      if (!output.trim()) {
        return [];
      }
      return output.trim().split('\n');
    } catch {
      return [];
    }
  }

  /**
   * Get list of changed files between base and head (or HEAD if not specified).
   */
  async getChangedFiles(base: string, head = 'HEAD'): Promise<readonly string[]> {
    try {
      const output = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], {
        encoding: 'utf-8',
        timeout: this.options.timeoutMs,
      });
      if (!output.trim()) {
        return [];
      }
      return output.trim().split('\n');
    } catch {
      return [];
    }
  }

  // ============================================================
  // Issue Operations (Extended)
  // ============================================================

  /**
   * Add a comment to an issue.
   */
  async commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void> {
    await this.execGhWithStdin<string>(
      ['issue', 'comment', String(issueNumber), '--repo', repo, '--body-file', '-'],
      body,
      false
    );
  }

  // ============================================================
  // PR Creation
  // ============================================================

  /**
   * Create a new PR.
   * Uses --body-file - to pass body via stdin, avoiding shell injection.
   */
  async createPr(options: {
    repo: string;
    title: string;
    body: string;
    base?: string;
    head?: string;
    draft?: boolean;
  }): Promise<IGhPrResponse> {
    // Build args array to avoid shell interpolation
    const args = ['pr', 'create', '--repo', options.repo, '--title', options.title];
    
    if (options.base) {
      args.push('--base', options.base);
    }
    if (options.head) {
      args.push('--head', options.head);
    }
    if (options.draft) {
      args.push('--draft');
    }

    // Use --body-file - to read body from stdin (avoids shell injection)
    args.push('--body-file', '-');

    // Create returns the URL, not JSON - so we get PR details after
    const url = await this.execGhWithStdin<string>(args, options.body, false);
    const prNumberMatch = url.match(/\/pull\/(\d+)/);
    if (!prNumberMatch) {
      throw new GithubClientError(`Failed to parse PR URL: ${url}`, 'UNKNOWN');
    }

    return this.getPr(options.repo, parseInt(prNumberMatch[1], 10));
  }

  // ============================================================
  // Health Check
  // ============================================================

  /**
   * Check if gh CLI is installed and authenticated.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }
}
