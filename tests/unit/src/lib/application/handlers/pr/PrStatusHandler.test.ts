/**
 * Tests for PrStatusHandler.
 *
 * Tests multi-PR status summary dashboard including:
 * - Fetching watched PRs
 * - Ready-for-merge logic
 * - Grouping by repository
 * - Priority sorting
 * - Formatted output
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  PrStatusHandler,
  type IPrStatusResult,
  type ReadyState,
} from '../../../../../../../src/lib/application/handlers/pr/PrStatusHandler';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IPullRequest, IPrCheck, IPrComment, IGitHubIssue } from '../../../../../../../src/lib/domain/interfaces/types/IPullRequest';

/**
 * Create a mock PR repository.
 */
function createMockRepository(options: {
  userId?: string;
  prs?: IPullRequest[];
} = {}): IPullRequestRepository {
  const userId = options.userId ?? 'user:testuser';
  const prs = options.prs ?? [];

  return {
    getUserId: async () => userId,
    findWatchedPrs: async (_userId: string, opts?: { repo?: string; limit?: number }) => {
      let items = prs.filter(pr => pr.watching);
      if (opts?.repo) {
        items = items.filter(pr => pr.repo === opts.repo);
      }
      if (opts?.limit) {
        items = items.slice(0, opts.limit);
      }
      return { items, hasMore: false };
    },
    findPr: async () => null,
    upsertPr: async () => ({} as IPullRequest),
    upsertIssue: async () => ({} as IGitHubIssue),
    upsertCheck: async () => ({} as IPrCheck),
    upsertComment: async () => ({} as IPrComment),
    linkPrToIssues: async () => {},
    setWatching: async () => {},
    deletePr: async () => {},
    getPrWithRelations: async () => null,
    findIssuesByPr: async () => [],
    findChecksByPr: async () => [],
    findCommentsByPr: async () => [],
    findIssue: async () => null,
    findPrsByIssue: async () => [],
    updateLastPolled: async () => {},
    supportsWrite: () => true,
    supportsRelationships: () => true,
  };
}

/**
 * Create a test PR.
 */
function createTestPr(overrides: Partial<IPullRequest> = {}): IPullRequest {
  return {
    type: 'pull_request',
    number: 1,
    repo: 'owner/repo',
    title: 'Test PR',
    status: 'open',
    watching: true,
    checksStatus: 'pending',
    unresolvedComments: 0,
    ...overrides,
  };
}

describe('PrStatusHandler', () => {
  describe('execute()', () => {
    it('should return success with no PRs when none are watched', async () => {
      const repo = createMockRepository({ prs: [] });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.byRepo.length, 0);
      assert.strictEqual(result.summary.total, 0);
      assert.ok(result.formattedOutput.includes('No PRs being watched'));
    });

    it('should return watched PRs grouped by repository', async () => {
      const prs = [
        createTestPr({ number: 1, repo: 'owner/repo-a', title: 'PR A1' }),
        createTestPr({ number: 2, repo: 'owner/repo-b', title: 'PR B1' }),
        createTestPr({ number: 3, repo: 'owner/repo-a', title: 'PR A2' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.byRepo.length, 2);
      assert.strictEqual(result.summary.total, 3);

      // Check grouping
      const repoA = result.byRepo.find(g => g.repo === 'owner/repo-a');
      const repoB = result.byRepo.find(g => g.repo === 'owner/repo-b');
      assert.ok(repoA);
      assert.ok(repoB);
      assert.strictEqual(repoA.prs.length, 2);
      assert.strictEqual(repoB.prs.length, 1);
    });

    it('should filter by repository when --repo is provided', async () => {
      const prs = [
        createTestPr({ number: 1, repo: 'owner/repo-a', title: 'PR A1' }),
        createTestPr({ number: 2, repo: 'owner/repo-b', title: 'PR B1' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute({ repo: 'owner/repo-a' });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.byRepo.length, 1);
      assert.strictEqual(result.byRepo[0].repo, 'owner/repo-a');
      assert.strictEqual(result.summary.total, 1);
    });

    it('should return failure on repository error', async () => {
      const repo = createMockRepository();
      repo.getUserId = async () => { throw new Error('Connection failed'); };
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Connection failed'));
    });

    it('should include user in result', async () => {
      const repo = createMockRepository({ userId: 'user:tonycasey', prs: [] });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.user, 'tonycasey');
    });
  });

  describe('ready-for-merge logic', () => {
    it('should mark PR as ready when checks pass and no comments', async () => {
      const prs = [
        createTestPr({ checksStatus: 'success', unresolvedComments: 0 }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'ready');
      assert.strictEqual(result.summary.ready, 1);
    });

    it('should mark PR as blocked when checks fail', async () => {
      const prs = [
        createTestPr({ checksStatus: 'failure', unresolvedComments: 0 }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'blocked');
      assert.strictEqual(result.summary.blocked, 1);
    });

    it('should mark PR as blocked when has unresolved comments', async () => {
      const prs = [
        createTestPr({ checksStatus: 'success', unresolvedComments: 2 }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'blocked');
    });

    it('should mark PR as pending when checks are pending', async () => {
      const prs = [
        createTestPr({ checksStatus: 'pending', unresolvedComments: 0 }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'pending');
      assert.strictEqual(result.summary.pending, 1);
    });

    it('should mark PR as merged when status is merged', async () => {
      const prs = [
        createTestPr({ status: 'merged', checksStatus: 'success' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'merged');
      assert.strictEqual(result.summary.merged, 1);
    });

    it('should mark PR as closed when status is closed', async () => {
      const prs = [
        createTestPr({ status: 'closed', checksStatus: 'success' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.byRepo[0].prs[0].readyState, 'closed');
      assert.strictEqual(result.summary.closed, 1);
    });
  });

  describe('priority sorting', () => {
    it('should sort PRs by priority: blocked > pending > ready', async () => {
      const prs = [
        createTestPr({ number: 1, checksStatus: 'success', unresolvedComments: 0 }), // ready
        createTestPr({ number: 2, checksStatus: 'pending', unresolvedComments: 0 }), // pending
        createTestPr({ number: 3, checksStatus: 'failure', unresolvedComments: 0 }), // blocked
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      const prNumbers = result.byRepo[0].prs.map(pr => pr.number);
      // blocked (3) first, then pending (2), then ready (1)
      assert.deepStrictEqual(prNumbers, [3, 2, 1]);
    });

    it('should sort repos alphabetically', async () => {
      const prs = [
        createTestPr({ number: 1, repo: 'owner/zebra' }),
        createTestPr({ number: 2, repo: 'owner/alpha' }),
        createTestPr({ number: 3, repo: 'owner/beta' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      const repos = result.byRepo.map(g => g.repo);
      assert.deepStrictEqual(repos, ['owner/alpha', 'owner/beta', 'owner/zebra']);
    });
  });

  describe('summary calculation', () => {
    it('should calculate correct summary counts', async () => {
      const prs = [
        createTestPr({ number: 1, checksStatus: 'success', unresolvedComments: 0 }), // ready
        createTestPr({ number: 2, checksStatus: 'success', unresolvedComments: 0 }), // ready
        createTestPr({ number: 3, checksStatus: 'failure', unresolvedComments: 0 }), // blocked
        createTestPr({ number: 4, checksStatus: 'pending', unresolvedComments: 0 }), // pending
        createTestPr({ number: 5, status: 'merged' }), // merged
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.strictEqual(result.summary.total, 5);
      assert.strictEqual(result.summary.ready, 2);
      assert.strictEqual(result.summary.blocked, 1);
      assert.strictEqual(result.summary.pending, 1);
      assert.strictEqual(result.summary.merged, 1);
      assert.strictEqual(result.summary.draft, 0);
      assert.strictEqual(result.summary.closed, 0);
    });
  });

  describe('formatted output', () => {
    it('should include header with user', async () => {
      const prs = [createTestPr()];
      const repo = createMockRepository({ userId: 'user:testuser', prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.ok(result.formattedOutput.includes('PR Status Summary'));
      assert.ok(result.formattedOutput.includes('user:testuser'));
    });

    it('should include repository sections', async () => {
      const prs = [
        createTestPr({ repo: 'owner/test-repo', title: 'Test PR' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.ok(result.formattedOutput.includes('owner/test-repo'));
    });

    it('should include summary line', async () => {
      const prs = [
        createTestPr({ checksStatus: 'success', unresolvedComments: 0 }),
        createTestPr({ number: 2, checksStatus: 'failure' }),
      ];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      assert.ok(result.formattedOutput.includes('Summary:'));
      assert.ok(result.formattedOutput.includes('2 PRs watched'));
    });

    it('should truncate long titles', async () => {
      const longTitle = 'This is a very long PR title that should be truncated to fit in the output';
      const prs = [createTestPr({ title: longTitle })];
      const repo = createMockRepository({ prs });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute();

      // Should contain truncated title with ellipsis
      assert.ok(result.formattedOutput.includes('…'));
      // Should NOT contain the full title
      assert.ok(!result.formattedOutput.includes(longTitle));
    });

    it('should show "No PRs being watched" for empty results with repo filter', async () => {
      const repo = createMockRepository({ prs: [] });
      const handler = new PrStatusHandler(repo);

      const result = await handler.execute({ repo: 'owner/specific-repo' });

      assert.ok(result.formattedOutput.includes('No PRs being watched in owner/specific-repo'));
    });
  });
});
