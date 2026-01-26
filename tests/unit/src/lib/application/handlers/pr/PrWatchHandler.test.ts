/**
 * Tests for PrWatchHandler
 *
 * Tests watch/unwatch/list operations for PR tracking.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrWatchHandler } from '../../../../../../../src/lib/application/handlers/pr/PrWatchHandler';
import type { GithubClient } from '../../../../../../../src/lib/infrastructure/github';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IPullRequest } from '../../../../../../../src/lib/domain/interfaces/types/IPullRequest';
import type { IGhPrResponse } from '../../../../../../../src/lib/infrastructure/github/types';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockGithubClient(overrides: Partial<GithubClient> = {}): GithubClient {
  return {
    getCurrentRepo: async () => 'owner/repo',
    getPr: async () => createMockPrResponse(),
    getPrChecks: async () => [],
    getPrComments: async () => [],
    getPrReviews: async () => [],
    getPrDiff: async () => '',
    getIssue: async () => ({ number: 1, title: 'Issue', state: 'OPEN', body: '', url: '', createdAt: '', updatedAt: '', labels: [], author: { login: 'user' } }),
    replyToComment: async () => ({ id: 1, user: { login: 'user' }, body: '', path: '', diff_hunk: '', created_at: '', updated_at: '', html_url: '' }),
    addReaction: async () => {},
    getCurrentUser: async () => ({ login: 'user', id: 1 }),
    getUserId: async () => 'user:test',
    createPr: async () => createMockPrResponse(),
    isAvailable: async () => true,
    ...overrides,
  } as unknown as GithubClient;
}

function createMockPrRepository(overrides: Partial<IPullRequestRepository> = {}): IPullRequestRepository {
  return {
    getUserId: async () => 'user:test',
    findPr: async () => null,
    findWatchedPrs: async () => ({ items: [], hasMore: false }),
    findIssue: async () => null,
    findIssuesByPr: async () => [],
    findPrsByIssue: async () => [],
    findChecksByPr: async () => [],
    findCommentsByPr: async () => [],
    getPrWithRelations: async () => null,
    upsertPr: async () => ({ type: 'pull_request', number: 1, repo: 'owner/repo', title: 'PR', status: 'open', watching: true, checksStatus: 'pending', unresolvedComments: 0 }),
    upsertIssue: async () => ({ type: 'issue', number: 1, repo: 'owner/repo', title: 'Issue', status: 'open', url: '' }),
    upsertCheck: async () => ({ type: 'pr_check', checkName: 'test', status: 'success', updatedAt: '' }),
    upsertComment: async () => ({ type: 'pr_comment', commentId: '1', file: '', line: 0, author: '', body: '', status: 'pending', hasNewReply: false, createdAt: '', updatedAt: '' }),
    linkPrToIssues: async () => {},
    setWatching: async () => {},
    updateLastPolled: async () => {},
    deletePr: async () => {},
    supportsWrite: () => true,
    supportsRelationships: () => true,
    ...overrides,
  };
}

function createMockPrResponse(overrides: Partial<IGhPrResponse> = {}): IGhPrResponse {
  return {
    number: 50,
    title: 'Test PR',
    state: 'OPEN',
    body: 'PR body',
    headRefName: 'feature',
    baseRefName: 'main',
    url: 'https://github.com/owner/repo/pull/50',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2026-01-26T10:00:00Z',
    updatedAt: '2026-01-26T10:00:00Z',
    author: { login: 'user' },
    repository: { nameWithOwner: 'owner/repo' },
    ...overrides,
  };
}

function createMockWatchedPr(number: number, title: string): IPullRequest {
  return {
    type: 'pull_request',
    number,
    repo: 'owner/repo',
    title,
    status: 'open',
    watching: true,
    watchingSince: '2026-01-26T10:00:00Z',
    checksStatus: 'success',
    unresolvedComments: 0,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrWatchHandler', () => {
  let handler: PrWatchHandler;
  let mockGithubClient: GithubClient;
  let mockPrRepository: IPullRequestRepository;

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockPrRepository = createMockPrRepository();
    handler = new PrWatchHandler(mockGithubClient, mockPrRepository);
  });

  describe('watch', () => {
    it('should start watching a PR successfully', async () => {
      const result = await handler.watch({ prNumber: 50 });

      assert.strictEqual(result.action, 'watch');
      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('watching PR #50'));
      assert.strictEqual(result.pr?.number, 50);
    });

    it('should use provided repo instead of detecting', async () => {
      let upsertedRepo: string | undefined;
      mockPrRepository = createMockPrRepository({
        upsertPr: async (_userId, pr) => {
          upsertedRepo = pr.repo;
          return { type: 'pull_request', number: pr.number, repo: pr.repo, title: pr.title, status: 'open', watching: true, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.watch({ prNumber: 50, repo: 'other/repo' });

      assert.strictEqual(upsertedRepo, 'other/repo');
    });

    it('should link closing issues when present', async () => {
      const linkedIssues: number[] = [];
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({
          closingIssuesReferences: [
            { number: 15, title: 'Issue 15', url: 'https://github.com/owner/repo/issues/15' },
            { number: 16, title: 'Issue 16', url: 'https://github.com/owner/repo/issues/16' },
          ],
        }),
      });
      mockPrRepository = createMockPrRepository({
        linkPrToIssues: async (_userId, _repo, _prNumber, issueNumbers) => {
          linkedIssues.push(...issueNumbers);
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.watch({ prNumber: 50 });

      assert.deepStrictEqual(linkedIssues, [15, 16]);
    });

    it('should return failure when PR does not exist', async () => {
      mockGithubClient = createMockGithubClient({
        getPr: async () => { throw new Error('Not found'); },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      const result = await handler.watch({ prNumber: 999 });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed'));
    });

    it('should map merged PR state correctly', async () => {
      let upsertedStatus: string | undefined;
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'MERGED' }),
      });
      mockPrRepository = createMockPrRepository({
        upsertPr: async (_userId, pr) => {
          upsertedStatus = pr.status;
          return { type: 'pull_request', number: pr.number, repo: pr.repo, title: pr.title, status: pr.status || 'open', watching: true, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.watch({ prNumber: 50 });

      assert.strictEqual(upsertedStatus, 'merged');
    });
  });

  describe('unwatch', () => {
    it('should stop watching a PR successfully', async () => {
      const result = await handler.unwatch({ prNumber: 50 });

      assert.strictEqual(result.action, 'unwatch');
      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('Stopped watching'));
    });

    it('should call setWatching with false', async () => {
      let setWatchingCalled = false;
      let watchingValue: boolean | undefined;
      mockPrRepository = createMockPrRepository({
        setWatching: async (_userId, _repo, _prNumber, watching) => {
          setWatchingCalled = true;
          watchingValue = watching;
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.unwatch({ prNumber: 50 });

      assert.strictEqual(setWatchingCalled, true);
      assert.strictEqual(watchingValue, false);
    });

    it('should return failure on error', async () => {
      mockPrRepository = createMockPrRepository({
        setWatching: async () => { throw new Error('Database error'); },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      const result = await handler.unwatch({ prNumber: 50 });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed'));
    });
  });

  describe('list', () => {
    it('should return empty list when no PRs watched', async () => {
      const result = await handler.list();

      assert.strictEqual(result.action, 'list');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'No PRs being watched');
      assert.deepStrictEqual(result.watchedPrs, []);
    });

    it('should return watched PRs', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [
            createMockWatchedPr(50, 'Test PR 1'),
            createMockWatchedPr(51, 'Test PR 2'),
          ],
          hasMore: false,
        }),
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      const result = await handler.list();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.watchedPrs?.length, 2);
      assert.ok(result.message.includes('2 PR(s)'));
    });

    it('should filter by repo when provided', async () => {
      let queryRepo: string | undefined;
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async (_userId, options) => {
          queryRepo = options?.repo;
          return { items: [], hasMore: false };
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.list({ repo: 'specific/repo' });

      assert.strictEqual(queryRepo, 'specific/repo');
    });

    it('should respect limit option', async () => {
      let queryLimit: number | undefined;
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async (_userId, options) => {
          queryLimit = options?.limit;
          return { items: [], hasMore: false };
        },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      await handler.list({ limit: 5 });

      assert.strictEqual(queryLimit, 5);
    });

    it('should return failure on error', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => { throw new Error('Database error'); },
      });
      handler = new PrWatchHandler(mockGithubClient, mockPrRepository);

      const result = await handler.list();

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed'));
    });
  });
});
