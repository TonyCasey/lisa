/**
 * Tests for PrChecksHandler
 *
 * Tests CI check status fetching and formatting.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrChecksHandler } from '../../../../../../../src/lib/application/handlers/pr/PrChecksHandler';
import type { GithubClient } from '../../../../../../../src/lib/infrastructure/github';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IGhCheckResponse, IGhPrResponse } from '../../../../../../../src/lib/infrastructure/github/types';

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

function createMockPrResponse(): IGhPrResponse {
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
  };
}

function createMockCheck(name: string, state: IGhCheckResponse['state']): IGhCheckResponse {
  return {
    name,
    state,
    conclusion: state === 'SUCCESS' ? 'success' : undefined,
    detailsUrl: `https://github.com/owner/repo/actions/${name}`,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrChecksHandler', () => {
  let handler: PrChecksHandler;
  let mockGithubClient: GithubClient;
  let mockPrRepository: IPullRequestRepository;

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockPrRepository = createMockPrRepository();
    handler = new PrChecksHandler(mockGithubClient, mockPrRepository);
  });

  describe('execute', () => {
    it('should return checks for a PR', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SUCCESS'),
          createMockCheck('security/scan', 'SUCCESS'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.prNumber, 50);
      assert.strictEqual(result.repo, 'owner/repo');
      assert.strictEqual(result.checks.length, 2);
      assert.strictEqual(result.overallStatus, 'success');
    });

    it('should detect failure when any check fails', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SUCCESS'),
          createMockCheck('tests', 'FAILURE'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.overallStatus, 'failure');
      assert.ok(result.summary.includes('failed'));
    });

    it('should detect pending when checks are in progress', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SUCCESS'),
          createMockCheck('tests', 'PENDING'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.overallStatus, 'pending');
      assert.ok(result.summary.includes('pending'));
    });

    it('should handle no checks gracefully', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.checks.length, 0);
      assert.strictEqual(result.overallStatus, 'pending');
      assert.strictEqual(result.summary, 'No checks found');
    });

    it('should use provided repo instead of detecting', async () => {
      const result = await handler.execute({
        prNumber: 50,
        repo: 'other/repo',
      });

      assert.strictEqual(result.repo, 'other/repo');
    });

    it('should save checks to Neo4j when saveToNeo4j is true', async () => {
      let savedChecks: string[] = [];
      mockPrRepository = createMockPrRepository({
        upsertCheck: async (_userId, _repo, _prNumber, check) => {
          savedChecks.push(check.checkName);
          return { type: 'pr_check', checkName: check.checkName, status: check.status, updatedAt: '' };
        },
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SUCCESS'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ prNumber: 50, saveToNeo4j: true });

      assert.deepStrictEqual(savedChecks, ['ci/build']);
    });

    it('should not save checks to Neo4j when saveToNeo4j is false', async () => {
      let savedChecks: string[] = [];
      mockPrRepository = createMockPrRepository({
        upsertCheck: async (_userId, _repo, _prNumber, check) => {
          savedChecks.push(check.checkName);
          return { type: 'pr_check', checkName: check.checkName, status: check.status, updatedAt: '' };
        },
      });
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SUCCESS'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ prNumber: 50, saveToNeo4j: false });

      assert.strictEqual(savedChecks.length, 0);
    });

    it('should include PR title in result', async () => {
      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.title, 'Test PR');
    });

    it('should map IN_PROGRESS state to pending', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'IN_PROGRESS'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.checks[0].status, 'pending');
    });

    it('should map CANCELLED state to cancelled', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'CANCELLED'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.checks[0].status, 'cancelled');
    });

    it('should map SKIPPED state to skipped', async () => {
      mockGithubClient = createMockGithubClient({
        getPrChecks: async () => [
          createMockCheck('ci/build', 'SKIPPED'),
        ],
      });
      handler = new PrChecksHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ prNumber: 50 });

      assert.strictEqual(result.checks[0].status, 'skipped');
    });
  });
});
