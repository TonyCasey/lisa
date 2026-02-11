/**
 * GitMemClient — thin wrapper around the `git mem` CLI.
 *
 * Uses `execa` to shell out to the globally-installed `git-mem` binary.
 * All methods are fail-safe: errors are caught and logged,
 * callers receive empty results or false rather than thrown exceptions.
 */

import { execa } from 'execa';
import type { IGitMemClient } from '../../domain/interfaces/IGitMemClient';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type {
  IGitMemEntry,
  IGitMemRecallResponse,
  IGitMemContextResponse,
  IRememberOptions,
  IRecallOptions,
  IContextOptions,
  IRetrofitOptions,
  IRetrofitResult,
} from './types';

const CLI_TIMEOUT_MS = 10_000;
const GIT_MEM_BIN = 'git-mem';

export class GitMemClient implements IGitMemClient {
  constructor(
    private readonly cwd: string,
    private readonly logger?: ILogger
  ) {}

  /**
   * Execute a git-mem CLI command.
   * @returns stdout on success, null on failure
   */
  private async exec(args: string[]): Promise<string | null> {
    try {
      const result = await execa(GIT_MEM_BIN, args, {
        cwd: this.cwd,
        timeout: CLI_TIMEOUT_MS,
        reject: false,
      });

      if (result.exitCode !== 0) {
        this.logger?.debug(`git-mem exited ${result.exitCode}`, {
          args: args.join(' '),
          stderr: result.stderr,
        });
        return null;
      }

      return result.stdout;
    } catch (error) {
      this.logger?.debug('git-mem exec failed', {
        args: args.join(' '),
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Store a memory via `git mem remember`.
   */
  async remember(text: string, options?: IRememberOptions): Promise<boolean> {
    const args = ['remember', text];

    if (options?.type) {
      args.push('--type', options.type);
    }
    if (options?.lifecycle) {
      args.push('--lifecycle', options.lifecycle);
    }
    if (options?.confidence) {
      args.push('--confidence', options.confidence);
    }
    if (options?.tags && options.tags.length > 0) {
      args.push('--tags', options.tags.join(','));
    }
    if (options?.commit) {
      args.push('--commit', options.commit);
    }

    const result = await this.exec(args);
    return result !== null;
  }

  /**
   * Search memories via `git mem recall`.
   */
  async recall(query?: string, options?: IRecallOptions): Promise<readonly IGitMemEntry[]> {
    const args = ['recall'];

    if (query) {
      args.push(query);
    }

    args.push('--json');

    if (options?.limit !== undefined) {
      args.push('--limit', String(options.limit));
    }
    if (options?.type) {
      args.push('--type', options.type);
    }
    if (options?.since) {
      args.push('--since', options.since);
    }
    if (options?.tag) {
      args.push('--tag', options.tag);
    }

    const stdout = await this.exec(args);
    if (!stdout) return [];

    try {
      const parsed: IGitMemRecallResponse = JSON.parse(stdout);
      return parsed.memories ?? [];
    } catch {
      this.logger?.debug('Failed to parse git-mem recall JSON', { stdout: stdout.slice(0, 200) });
      return [];
    }
  }

  /**
   * Get memories relevant to staged changes via `git mem context`.
   */
  async context(options?: IContextOptions): Promise<readonly IGitMemEntry[]> {
    const args = ['context', '--json'];

    if (options?.limit !== undefined) {
      args.push('--limit', String(options.limit));
    }
    if (options?.threshold !== undefined) {
      args.push('--threshold', String(options.threshold));
    }

    const stdout = await this.exec(args);
    if (!stdout) return [];

    try {
      const parsed: IGitMemContextResponse = JSON.parse(stdout);
      return parsed.memories ?? [];
    } catch {
      this.logger?.debug('Failed to parse git-mem context JSON', { stdout: stdout.slice(0, 200) });
      return [];
    }
  }

  /**
   * Scan commit history via `git mem retrofit`.
   */
  async retrofit(options?: IRetrofitOptions): Promise<IRetrofitResult> {
    const args = ['retrofit'];

    if (options?.since) {
      args.push('--since', options.since);
    }
    if (options?.maxCommits !== undefined) {
      args.push('--max-commits', String(options.maxCommits));
    }
    if (options?.threshold !== undefined) {
      args.push('--threshold', String(options.threshold));
    }
    if (options?.dryRun) {
      args.push('--dry-run');
    }

    const stdout = await this.exec(args);
    return {
      success: stdout !== null,
      output: stdout ?? '',
    };
  }
}
