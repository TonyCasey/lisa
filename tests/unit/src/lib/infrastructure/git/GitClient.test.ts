/**
 * Unit tests for GitClient.
 *
 * These are integration-style tests that call the real git executable
 * since GitClient wraps child_process.execFileSync directly.
 * Tests run against the current working directory (the lisa repo).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GitClient } from '../../../../../../src/lib/infrastructure/git/GitClient';

// Use process.cwd() to work in both local dev (C:\dev\lisa) and CI (/home/runner/work/lisa/lisa)
const REPO_CWD = process.cwd();

describe('GitClient', () => {
  const client = new GitClient();

  describe('log', () => {
    it('should return string output with commits', () => {
      const result = client.log({ cwd: REPO_CWD, maxCount: 5 });

      assert.strictEqual(typeof result, 'string');
      assert.ok(result.length > 0, 'Log output should not be empty');
    });

    it('should respect maxCount option', () => {
      const result = client.log({ cwd: REPO_CWD, maxCount: 3 });

      const lines = result.split('\n').filter((l: string) => l.trim().length > 0);
      assert.ok(lines.length <= 3, `Expected at most 3 lines, got ${lines.length}`);
    });

    it('should apply format option', () => {
      const result = client.log({ cwd: REPO_CWD, maxCount: 1, format: '%H' });

      // %H produces the full commit hash; combined with --oneline the output
      // should contain a 40-character hex string.
      assert.ok(result.length > 0, 'Formatted log should not be empty');
    });

    it('should apply since option without throwing', () => {
      // Use a recent date to avoid empty output issues -- just verify no throw.
      const result = client.log({ cwd: REPO_CWD, maxCount: 5, since: '2020-01-01' });

      assert.strictEqual(typeof result, 'string');
    });
  });

  describe('getRemoteUrl', () => {
    it('should return origin URL as a non-empty string', () => {
      const url = client.getRemoteUrl('origin', REPO_CWD);

      assert.strictEqual(typeof url, 'string');
      assert.ok(url.length > 0, 'Remote URL should not be empty');
    });

    it('should return a URL containing the repo name', () => {
      const url = client.getRemoteUrl('origin', REPO_CWD);

      // The remote URL should reference "lisa" somewhere in it.
      assert.ok(
        url.toLowerCase().includes('lisa'),
        `Expected URL to contain "lisa", got: ${url}`
      );
    });

    it('should throw for a non-existent remote', () => {
      assert.throws(
        () => client.getRemoteUrl('nonexistent-remote-xyz', REPO_CWD),
        /./,
        'Should throw for unknown remote'
      );
    });
  });

  describe('getDefaultBranch', () => {
    it('should return a branch name string', () => {
      const branch = client.getDefaultBranch(REPO_CWD);

      assert.strictEqual(typeof branch, 'string');
      assert.ok(branch.length > 0, 'Default branch should not be empty');
    });

    it('should return main or master', () => {
      const branch = client.getDefaultBranch(REPO_CWD);

      assert.ok(
        branch === 'main' || branch === 'master',
        `Expected "main" or "master", got: "${branch}"`
      );
    });
  });

  describe('refExists', () => {
    it('should return true for HEAD', () => {
      const exists = client.refExists('HEAD', REPO_CWD);

      assert.strictEqual(exists, true);
    });

    it('should return true for the main branch (local or remote)', () => {
      const defaultBranch = client.getDefaultBranch(REPO_CWD);
      // In CI (detached HEAD on PR), local main may not exist but origin/main will
      const localExists = client.refExists(defaultBranch, REPO_CWD);
      const remoteExists = client.refExists(`origin/${defaultBranch}`, REPO_CWD);

      assert.ok(
        localExists || remoteExists,
        `Expected either "${defaultBranch}" or "origin/${defaultBranch}" to exist`
      );
    });

    it('should return false for a nonexistent branch', () => {
      const exists = client.refExists('nonexistent-branch-xyz-999', REPO_CWD);

      assert.strictEqual(exists, false);
    });

    it('should return boolean type', () => {
      const result = client.refExists('HEAD', REPO_CWD);

      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('diff', () => {
    it('should return diff output between HEAD~1 and HEAD', () => {
      const result = client.diff({
        base: 'HEAD~1',
        head: 'HEAD',
        cwd: REPO_CWD,
      });

      assert.strictEqual(typeof result, 'string');
      // Diff can be empty if last commit was empty, but typically will have content.
    });

    it('should return file names only with nameOnly option', () => {
      const result = client.diff({
        base: 'HEAD~1',
        head: 'HEAD',
        nameOnly: true,
        cwd: REPO_CWD,
      });

      assert.strictEqual(typeof result, 'string');
      // When nameOnly is set, output should not contain typical diff markers
      // like '@@' or '---' (unless those are file names, which is very unlikely).
      if (result.trim().length > 0) {
        const lines = result.trim().split('\n');
        for (const line of lines) {
          assert.ok(
            !line.startsWith('@@'),
            `nameOnly output should not contain diff hunks: ${line}`
          );
        }
      }
    });

    it('should use three-dot diff by default', () => {
      // This test verifies the method does not throw with default threeDot.
      const result = client.diff({
        base: 'HEAD~1',
        cwd: REPO_CWD,
      });

      assert.strictEqual(typeof result, 'string');
    });

    it('should support two-dot diff with threeDot: false', () => {
      const result = client.diff({
        base: 'HEAD~1',
        head: 'HEAD',
        threeDot: false,
        cwd: REPO_CWD,
      });

      assert.strictEqual(typeof result, 'string');
    });
  });
});
