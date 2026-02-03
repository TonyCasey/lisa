/**
 * GitClient
 *
 * Infrastructure implementation of IGitClient.
 * Wraps git CLI operations using child_process.execFileSync (shell: false).
 */

import { execFileSync } from 'child_process';
import type {
  IGitClient,
  IGitLogOptions,
  IGitDiffOptions,
  IGitLogDetailedOptions,
  IGitLogCommit,
  IGitCommitStatEntry,
  IGitTag,
} from '../../domain/interfaces/IGitClient';

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

  /**
   * Record separator for parsing detailed log output.
   * Using ASCII RS (Record Separator) to avoid conflicts with commit content.
   */
  private static readonly RECORD_SEP = '\x1e';
  private static readonly FIELD_SEP = '\x1f';

  logDetailed(options: IGitLogDetailedOptions): IGitLogCommit[] {
    // Custom format: SHA|shortSHA|parents|subject|body|authorName|authorEmail|timestamp|refs
    // Using ASCII separators to avoid conflicts with commit message content
    const format = [
      '%H', // full sha
      '%h', // short sha
      '%P', // parent shas (space-separated)
      '%s', // subject
      '%b', // body
      '%an', // author name
      '%ae', // author email
      '%at', // author timestamp (unix)
      '%D', // ref names
    ].join(GitClient.FIELD_SEP);

    const args: string[] = [
      'log',
      `--format=${GitClient.RECORD_SEP}${format}`,
    ];

    if (options.since) args.push(`--since=${options.since}`);
    if (options.until) args.push(`--until=${options.until}`);
    if (options.maxCount) args.push(`-n${options.maxCount}`);

    try {
      const output = execFileSync('git', args, {
        encoding: 'utf8',
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repos
      }).trim();

      if (!output) return [];

      // Split by record separator and parse each commit
      const records = output.split(GitClient.RECORD_SEP).filter(r => r.trim());
      return records.map(record => {
        const fields = record.split(GitClient.FIELD_SEP);
        return {
          sha: fields[0] || '',
          shortSha: fields[1] || '',
          parentShas: (fields[2] || '').split(' ').filter(s => s),
          subject: fields[3] || '',
          body: (fields[4] || '').trim(),
          authorName: fields[5] || '',
          authorEmail: fields[6] || '',
          authorTimestamp: parseInt(fields[7] || '0', 10),
          refNames: fields[8] || '',
        };
      });
    } catch {
      return [];
    }
  }

  getCommitStats(sha: string, cwd?: string): IGitCommitStatEntry[] {
    try {
      // Use --numstat for machine-readable stats
      // Format: added<TAB>deleted<TAB>path
      // For binary files: -<TAB>-<TAB>path
      const output = execFileSync(
        'git',
        ['show', '--numstat', '--format=', sha],
        {
          encoding: 'utf8',
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      if (!output) return [];

      // Also get the list of added/deleted files
      const statusOutput = execFileSync(
        'git',
        ['show', '--name-status', '--format=', sha],
        {
          encoding: 'utf8',
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      // Parse status to determine new/deleted files
      const statusMap = new Map<string, string>();
      for (const line of statusOutput.split('\n')) {
        const match = line.match(/^([AMDRC])\t(.+)$/);
        if (match) {
          statusMap.set(match[2], match[1]);
        }
      }

      return output.split('\n').filter(line => line.trim()).map(line => {
        const parts = line.split('\t');
        const added = parts[0] === '-' ? null : parseInt(parts[0], 10);
        const deleted = parts[1] === '-' ? null : parseInt(parts[1], 10);
        const path = parts[2] || '';
        const status = statusMap.get(path) || 'M';

        return {
          added,
          deleted,
          path,
          isNew: status === 'A',
          isDeleted: status === 'D',
        };
      });
    } catch {
      return [];
    }
  }

  listTags(cwd?: string): IGitTag[] {
    try {
      // Get tags with their full commit SHAs (needed for tag-adjacency matching)
      const output = execFileSync(
        'git',
        ['tag', '-l', '--format=%(refname:short)\t%(objectname)'],
        {
          encoding: 'utf8',
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      if (!output) return [];

      return output.split('\n').filter(line => line.trim()).map(line => {
        const [name, sha] = line.split('\t');
        return { name: name || '', sha: sha || '' };
      });
    } catch {
      return [];
    }
  }

  countCommits(cwd?: string): number {
    try {
      const output = execFileSync(
        'git',
        ['rev-list', '--count', 'HEAD'],
        {
          encoding: 'utf8',
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      return parseInt(output, 10) || 0;
    } catch {
      return 0;
    }
  }
}
