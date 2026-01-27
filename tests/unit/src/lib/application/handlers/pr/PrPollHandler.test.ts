/**
 * Tests for PrPollHandler
 *
 * Tests polling of watched PRs for state changes.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrPollHandler } from '../../../../../../../src/lib/application/handlers/pr/PrPollHandler';
import type { GithubClient } from '../../../../../../../src/lib/infrastructure/github';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IPullRequest, IPrComment } from '../../../../../../../src/lib/domain/interfaces/types/IPullRequest';
import type { IGhPrResponse, IGhCheckResponse, IGhReviewCommentResponse } from '../../../../../../../src/lib/infrastructure/github/types';
import { GithubClientError } from '../../../../../../../src/lib/infrastructure/github/types';

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

function createMockWatchedPr(number: number, overrides: Partial<IPullRequest> = {}): IPullRequest {
  return {
    type: 'pull_request',
    number,
    repo: 'owner/repo',
    title: `Test PR #${number}`,
    status: 'open',
    watching: true,
    watchingSince: '2026-01-26T10:00:00Z',
    checksStatus: 'pending',
    unresolvedComments: 0,
    ...overrides,
  };
}

function createMockCheck(name: string, state: IGhCheckResponse['state']): IGhCheckResponse {
  return {
    name,
    state,
    conclusion: state === 'SUCCESS' ? 'success' : state === 'FAILURE' ? 'failure' : undefined,
    detailsUrl: `https://github.com/owner/repo/checks/${name}`,
    startedAt: '2026-01-26T10:00:00Z',
    completedAt: state !== 'PENDING' ? '2026-01-26T10:05:00Z' : undefined,
  };
}

function createMockComment(id: number, author: string, path: string, line: number): IGhReviewCommentResponse {
  return {
    id,
    user: { login: author },
    body: `Comment ${id}`,
    path,
    line,
    original_line: line,
    diff_hunk: '@@ -1,3 +1,5 @@',
    created_at: '2026-01-26T10:00:00Z',
    updated_at: '2026-01-26T10:00:00Z',
    html_url: `https://github.com/owner/repo/pull/50#discussion_r${id}`,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrPollHandler', () => {
  let handler: PrPollHandler;
  let mockGithubClient: GithubClient;
  let mockPrRepository: IPullRequestRepository;

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockPrRepository = createMockPrRepository();
    handler = new PrPollHandler(mockGithubClient, mockPrRepository);
  });

  describe('poll', () => {
    it('should return success with no PRs when none are watched', async () => {
      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'No PRs being watched');
      assert.strictEqual(result.totalWatched, 0);
      assert.strictEqual(result.totalChanges, 0);
      assert.strictEqual(result.items.length, 0);
    });

    it('should poll all watched PRs', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [
            createMockWatchedPr(50),
            createMockWatchedPr(51),
          ],
          hasMore: false,
        }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalWatched, 2);
      assert.strictEqual(result.items.length, 2);
    });

    it('should detect check status changes', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { checksStatus: 'pending' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [createMockCheck('build', 'SUCCESS')],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalChanges, 1);
      assert.strictEqual(result.items[0].changes.length, 1);
      assert.strictEqual(result.items[0].changes[0].type, 'checks_updated');
      assert.ok(result.items[0].changes[0].description.includes('pending'));
      assert.ok(result.items[0].changes[0].description.includes('success'));
    });

    it('should detect PR merged', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { status: 'open' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'MERGED' }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      const prMergedChange = result.items[0].changes.find(c => c.type === 'pr_merged');
      assert.ok(prMergedChange);
      assert.strictEqual(result.items[0].currentState.status, 'merged');
    });

    it('should detect PR closed', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { status: 'open' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'CLOSED' }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      const prClosedChange = result.items[0].changes.find(c => c.type === 'pr_closed');
      assert.ok(prClosedChange);
    });

    it('should detect new comments', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        findCommentsByPr: async () => [], // No existing comments
      });
      mockGithubClient = createMockGithubClient({
        getPrComments: async () => [
          createMockComment(123, 'reviewer', 'src/file.ts', 42),
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      const newCommentChange = result.items[0].changes.find(c => c.type === 'new_comment');
      assert.ok(newCommentChange);
      assert.ok(newCommentChange.description.includes('@reviewer'));
      assert.ok(newCommentChange.description.includes('src/file.ts:42'));
    });

    it('should detect replies to our comments', async () => {
      const existingComment: IPrComment = {
        type: 'pr_comment',
        commentId: '100',
        file: 'src/file.ts',
        line: 42,
        author: 'user',
        body: 'Our response',
        status: 'pending',
        ourReplyId: '100',
        hasNewReply: false,
        createdAt: '2026-01-26T09:00:00Z',
        updatedAt: '2026-01-26T09:00:00Z',
      };

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        findCommentsByPr: async () => [existingComment],
      });
      mockGithubClient = createMockGithubClient({
        getPrComments: async () => [
          // New reply to our comment
          {
            id: 200,
            user: { login: 'reviewer' },
            body: 'Reply to your fix',
            path: 'src/file.ts',
            line: 42,
            original_line: 42,
            diff_hunk: '@@ -1,3 +1,5 @@',
            created_at: '2026-01-26T11:00:00Z',
            updated_at: '2026-01-26T11:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/50#discussion_r200',
            in_reply_to_id: 100, // Replying to our comment
          },
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      const newReplyChange = result.items[0].changes.find(c => c.type === 'new_reply');
      assert.ok(newReplyChange);
      assert.ok(newReplyChange.description.includes('@reviewer'));
    });

    it('should auto-unwatch merged PRs by default', async () => {
      let setWatchingCalled = false;
      let watchingValue: boolean | undefined;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        setWatching: async (_userId, _repo, _prNumber, watching) => {
          setWatchingCalled = true;
          watchingValue = watching;
        },
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'MERGED' }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.items[0].unwatched, true);
      assert.strictEqual(setWatchingCalled, true);
      assert.strictEqual(watchingValue, false);
    });

    it('should not auto-unwatch when disabled', async () => {
      let setWatchingCalled = false;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        setWatching: async () => {
          setWatchingCalled = true;
        },
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'MERGED' }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ autoUnwatch: false, logToFile: false });

      assert.strictEqual(result.items[0].unwatched, false);
      assert.strictEqual(setWatchingCalled, false);
    });

    it('should update lastPolled timestamp', async () => {
      let lastPolledUpdated = false;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        updateLastPolled: async () => {
          lastPolledUpdated = true;
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ logToFile: false });

      assert.strictEqual(lastPolledUpdated, true);
    });

    it('should handle rate limiting gracefully', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => {
          throw new GithubClientError('Rate limit exceeded', 'RATE_LIMITED');
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      // Should not fail entirely, but mark the item as errored
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalErrors, 1);
      assert.ok(result.items[0].error?.includes('Rate limit'));
    });

    it('should handle individual PR errors without failing entire poll', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [
            createMockWatchedPr(50),
            createMockWatchedPr(51),
          ],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async (_repo, num) => {
          if (num === 50) {
            throw new Error('Not found');
          }
          return createMockPrResponse({ number: num });
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, false); // Has errors
      assert.strictEqual(result.totalErrors, 1);
      assert.ok(result.items[0].error);
      assert.strictEqual(result.items[1].error, undefined);
    });

    it('should calculate overall check status correctly', async () => {
      // Test failure takes precedence
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { checksStatus: 'pending' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('build', 'SUCCESS'),
          createMockCheck('test', 'FAILURE'),
          createMockCheck('lint', 'SUCCESS'),
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.items[0].currentState.checksStatus, 'failure');
    });

    it('should return success when all checks pass', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { checksStatus: 'pending' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('build', 'SUCCESS'),
          createMockCheck('test', 'SUCCESS'),
          createMockCheck('lint', 'SKIPPED'),
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.items[0].currentState.checksStatus, 'success');
    });

    it('should respect concurrency option', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [
            createMockWatchedPr(50),
            createMockWatchedPr(51),
            createMockWatchedPr(52),
            createMockWatchedPr(53),
            createMockWatchedPr(54),
          ],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async (_repo, num) => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(resolve => setTimeout(resolve, 10));
          currentConcurrent--;
          return createMockPrResponse({ number: num });
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ concurrency: 2, logToFile: false });

      // Should never exceed 2 concurrent
      assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    });

    it('should store new comments in Neo4j', async () => {
      const upsertedComments: { commentId: string; author: string }[] = [];

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        findCommentsByPr: async () => [],
        upsertComment: async (_userId, _repo, _prNumber, comment) => {
          upsertedComments.push({ commentId: comment.commentId, author: comment.author });
          return {
            type: 'pr_comment',
            commentId: comment.commentId,
            file: comment.file,
            line: comment.line,
            author: comment.author,
            body: comment.body,
            status: comment.status,
            hasNewReply: comment.hasNewReply,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
          };
        },
      });
      mockGithubClient = createMockGithubClient({
        getPrComments: async () => [
          createMockComment(123, 'reviewer', 'src/file.ts', 42),
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ logToFile: false });

      assert.strictEqual(upsertedComments.length, 1);
      assert.strictEqual(upsertedComments[0].commentId, '123');
      assert.strictEqual(upsertedComments[0].author, 'reviewer');
    });

    it('should update PR state in Neo4j', async () => {
      let upsertedPr: { number: number; status?: string } | undefined;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
        upsertPr: async (_userId, pr) => {
          upsertedPr = { number: pr.number, status: pr.status };
          return {
            type: 'pull_request',
            number: pr.number,
            repo: pr.repo,
            title: pr.title,
            status: pr.status || 'open',
            watching: true,
            checksStatus: 'pending',
            unresolvedComments: 0,
          };
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ logToFile: false });

      assert.ok(upsertedPr);
      assert.strictEqual(upsertedPr.number, 50);
      assert.strictEqual(upsertedPr.status, 'open');
    });

    it('should report no changes when nothing changed', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { checksStatus: 'pending', status: 'open' })],
          hasMore: false,
        }),
      });
      mockGithubClient = createMockGithubClient({
        getPr: async () => createMockPrResponse({ state: 'OPEN' }),
        getPrChecks: async () => [], // Still pending (no checks = pending)
        getPrComments: async () => [],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      const result = await handler.poll({ logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalChanges, 0);
      assert.strictEqual(result.items[0].changes.length, 0);
    });

    it('should persist checksStatus and unresolvedComments to Neo4j', async () => {
      let upsertedPr: { checksStatus?: string; unresolvedComments?: number } | undefined;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50, { checksStatus: 'pending' })],
          hasMore: false,
        }),
        upsertPr: async (_userId, pr) => {
          upsertedPr = { checksStatus: pr.checksStatus, unresolvedComments: pr.unresolvedComments };
          return {
            type: 'pull_request',
            number: pr.number,
            repo: pr.repo,
            title: pr.title,
            status: pr.status || 'open',
            watching: true,
            checksStatus: pr.checksStatus || 'pending',
            unresolvedComments: pr.unresolvedComments || 0,
          };
        },
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [createMockCheck('build', 'SUCCESS')],
        getPrComments: async () => [
          createMockComment(1, 'reviewer', 'file.ts', 10),
          createMockComment(2, 'reviewer', 'file.ts', 20),
        ],
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ logToFile: false });

      assert.ok(upsertedPr);
      assert.strictEqual(upsertedPr.checksStatus, 'success');
      assert.strictEqual(upsertedPr.unresolvedComments, 2);
    });

    it('should limit watched PRs to 10', async () => {
      let requestedLimit: number | undefined;

      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async (_userId, options) => {
          requestedLimit = options?.limit;
          return { items: [], hasMore: false };
        },
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      await handler.poll({ logToFile: false });

      // Should request max 10 PRs to avoid rate limiting
      assert.strictEqual(requestedLimit, 10);
    });

    it('should guard against zero concurrency', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      // Should not hang with concurrency 0 - should use minimum of 1
      const result = await handler.poll({ concurrency: 0, logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.items.length, 1);
    });

    it('should guard against negative concurrency', async () => {
      mockPrRepository = createMockPrRepository({
        findWatchedPrs: async () => ({
          items: [createMockWatchedPr(50)],
          hasMore: false,
        }),
      });
      handler = new PrPollHandler(mockGithubClient, mockPrRepository);

      // Should not hang with negative concurrency - should use minimum of 1
      const result = await handler.poll({ concurrency: -5, logToFile: false });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.items.length, 1);
    });
  });
});
