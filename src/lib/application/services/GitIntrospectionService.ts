/**
 * GitIntrospectionService
 *
 * Provides git introspection capabilities for session context:
 * - Load recent git commits
 * - Detect GitHub repository from remote URL
 *
 * Extracted from SessionStartHandler for testability.
 */

import type { IGitCommit } from './SessionContextFormatter';

const MAX_GIT_COMMITS = 10;

export class GitIntrospectionService {
  /**
   * Load recent git commits for context.
   * @param since - Date to start from
   * @param projectRoot - Project root directory
   * @returns Array of commit summaries
   */
  async loadGitCommits(since: Date | undefined, projectRoot: string): Promise<IGitCommit[]> {
    if (!since) return [];

    try {
      const { execSync } = await import('child_process');
      const sinceArg = since.toISOString().split('T')[0]; // YYYY-MM-DD format
      const output = execSync(
        `git log --since="${sinceArg}" --oneline --format="%h %s" -${MAX_GIT_COMMITS}`,
        {
          encoding: 'utf8',
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      if (!output) return [];

      return output.split('\n').filter(Boolean).map(line => {
        const spaceIndex = line.indexOf(' ');
        return {
          hash: line.slice(0, spaceIndex),
          message: line.slice(spaceIndex + 1),
        };
      });
    } catch {
      // Git not available or not a git repo - that's fine
      return [];
    }
  }

  /**
   * Detect the GitHub repository from git remote.
   * Returns owner/repo format or null if not a GitHub repo.
   */
  async detectGitHubRepo(projectRoot: string): Promise<string | null> {
    try {
      const { execSync } = await import('child_process');
      const remote = execSync('git remote get-url origin', {
        encoding: 'utf8',
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Parse GitHub URL formats:
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/.]+)/);
      const sshMatch = remote.match(/github\.com:([^/]+\/[^/.]+)/);

      const match = httpsMatch || sshMatch;
      if (match) {
        return match[1].replace(/\.git$/, '');
      }
      return null;
    } catch {
      return null;
    }
  }
}
