/**
 * GitClient
 *
 * Infrastructure implementation of IGitClient.
 * Wraps git CLI operations using child_process.execFileSync (shell: false).
 */

import { execFileSync } from 'child_process';
import type { IGitClient, IGitLogOptions, IGitDiffOptions } from '../../domain/interfaces/IGitClient';

export class GitClient implements IGitClient {
  log(options: IGitLogOptions): string {
    const args: string[] = ['log'];
    if (options.since) args.push(`--since=${options.since}`);
    if (options.format) args.push(`--format=${options.format}`);
    if (options.maxCount) args.push(`-${options.maxCount}`);
    args.push('--oneline');

    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  getRemoteUrl(remote: string, cwd?: string): string {
    return execFileSync('git', ['remote', 'get-url', remote], {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  getDefaultBranch(cwd?: string): string {
    // Try to get from remote HEAD
    try {
      const result = execFileSync('git', ['remote', 'show', 'origin'], {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const match = result.match(/HEAD branch:\s*(.+)/);
      if (match) return match[1].trim();
    } catch {
      // Ignore — remote may not be accessible
    }

    // Fallback: check if main exists
    if (this.refExists('main', cwd)) return 'main';
    return 'master';
  }

  diff(options: IGitDiffOptions): string {
    const separator = options.threeDot !== false ? '...' : '..';
    const head = options.head || 'HEAD';
    const args = ['diff'];
    if (options.nameOnly) args.push('--name-only');
    args.push(`${options.base}${separator}${head}`);

    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: options.cwd,
      maxBuffer: options.maxBuffer,
    });
  }

  refExists(ref: string, cwd?: string): boolean {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
