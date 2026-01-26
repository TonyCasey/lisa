/**
 * Tests for IPullRequest domain types.
 *
 * Tests the factory functions and type definitions for PR entities.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createPullRequest,
  createGitHubIssue,
  type IPullRequest,
  type IGitHubIssue,
  type IPullRequestInput,
  type IGitHubIssueInput,
} from '../../../../../../../src/lib/domain/interfaces/types/IPullRequest';

describe('IPullRequest Types', () => {
  describe('createPullRequest()', () => {
    it('should create a PR with required fields', () => {
      const input: IPullRequestInput = {
        number: 42,
        repo: 'owner/repo',
        title: 'Add new feature',
      };

      const pr = createPullRequest(input);

      assert.strictEqual(pr.type, 'pull_request');
      assert.strictEqual(pr.number, 42);
      assert.strictEqual(pr.repo, 'owner/repo');
      assert.strictEqual(pr.title, 'Add new feature');
      assert.strictEqual(pr.status, 'open');
      assert.strictEqual(pr.watching, true);
      assert.strictEqual(pr.checksStatus, 'pending');
      assert.strictEqual(pr.unresolvedComments, 0);
      assert.ok(pr.watchingSince); // Should have a timestamp
    });

    it('should respect custom status', () => {
      const input: IPullRequestInput = {
        number: 42,
        repo: 'owner/repo',
        title: 'Merged PR',
        status: 'merged',
      };

      const pr = createPullRequest(input);

      assert.strictEqual(pr.status, 'merged');
    });

    it('should respect watching: false', () => {
      const input: IPullRequestInput = {
        number: 42,
        repo: 'owner/repo',
        title: 'Not watching',
        watching: false,
      };

      const pr = createPullRequest(input);

      assert.strictEqual(pr.watching, false);
      assert.strictEqual(pr.watchingSince, undefined);
    });

    it('should generate watchingSince timestamp when watching', () => {
      const before = new Date().toISOString();

      const input: IPullRequestInput = {
        number: 42,
        repo: 'owner/repo',
        title: 'Watching PR',
        watching: true,
      };

      const pr = createPullRequest(input);

      const after = new Date().toISOString();

      assert.ok(pr.watchingSince);
      assert.ok(pr.watchingSince >= before);
      assert.ok(pr.watchingSince <= after);
    });
  });

  describe('createGitHubIssue()', () => {
    it('should create an issue with required fields', () => {
      const input: IGitHubIssueInput = {
        number: 15,
        repo: 'owner/repo',
        title: 'Bug report',
        url: 'https://github.com/owner/repo/issues/15',
      };

      const issue = createGitHubIssue(input);

      assert.strictEqual(issue.type, 'issue');
      assert.strictEqual(issue.number, 15);
      assert.strictEqual(issue.repo, 'owner/repo');
      assert.strictEqual(issue.title, 'Bug report');
      assert.strictEqual(issue.status, 'open');
      assert.strictEqual(issue.url, 'https://github.com/owner/repo/issues/15');
    });

    it('should respect custom status', () => {
      const input: IGitHubIssueInput = {
        number: 15,
        repo: 'owner/repo',
        title: 'Closed issue',
        status: 'closed',
        url: 'https://github.com/owner/repo/issues/15',
      };

      const issue = createGitHubIssue(input);

      assert.strictEqual(issue.status, 'closed');
    });
  });

  describe('Type validation', () => {
    it('IPullRequest should have correct shape', () => {
      const pr: IPullRequest = {
        type: 'pull_request',
        number: 1,
        repo: 'owner/repo',
        title: 'Test',
        status: 'open',
        watching: true,
        checksStatus: 'pending',
        unresolvedComments: 0,
      };

      // Type assertions - these will fail compilation if types are wrong
      const _type: 'pull_request' = pr.type;
      const _number: number = pr.number;
      const _repo: string = pr.repo;
      const _title: string = pr.title;
      const _status: 'open' | 'merged' | 'closed' = pr.status;
      const _watching: boolean = pr.watching;
      const _checksStatus: 'pending' | 'success' | 'failure' | 'cancelled' | 'skipped' = pr.checksStatus;
      const _unresolvedComments: number = pr.unresolvedComments;

      assert.ok(pr);
    });

    it('IGitHubIssue should have correct shape', () => {
      const issue: IGitHubIssue = {
        type: 'issue',
        number: 1,
        repo: 'owner/repo',
        title: 'Test',
        status: 'open',
        url: 'https://github.com/owner/repo/issues/1',
      };

      // Type assertions
      const _type: 'issue' = issue.type;
      const _number: number = issue.number;
      const _repo: string = issue.repo;
      const _title: string = issue.title;
      const _status: 'open' | 'closed' = issue.status;
      const _url: string = issue.url;

      assert.ok(issue);
    });
  });
});
