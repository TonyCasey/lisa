/**
 * Tests for PrLinkHandler
 *
 * Tests linking PRs to issues with CLOSES relationships.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrLinkHandler } from '../../../../../../../src/lib/application/handlers/pr/PrLinkHandler';
import type { GithubClient } from '../../../../../../../src/lib/infrastructure/github';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IGhPrResponse, IGhIssueResponse } from '../../../../../../../src/lib/infrastructure/github/types';
import type { IGitHubIssue } from '../../../../../../../src/lib/domain/interfaces/types/IPullRequest';

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
    getIssue: async () => createMockIssueResponse(),
    replyToComment: async () => ({ id: 1, user: { login: 'user' }, body: '', path: '', diff_hunk: '', created_at: '', updated_at: '', html_url: '' }),
    addReaction: async () => {},
    getCurrentUser: async () => ({ login: 'user', id: 1 }),
    getUserId: async () => 'user:test',
    createPr: async () => createMockPrResponse(),
    commentOnIssue: async () => {},
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
    upsertPr: async () => ({ type: 'pull_request', number: 1, repo: 'owner/repo', title: 'PR', status: 'open', watching: false, checksStatus: 'pending', unresolvedComments: 0 }),
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
    headRepository: { nameWithOwner: 'owner/repo' },
    ...overrides,
  };
}

function createMockIssueResponse(overrides: Partial<IGhIssueResponse> = {}): IGhIssueResponse {
  return {
    number: 15,
    title: 'Test Issue',
    state: 'OPEN',
    body: 'Issue body',
    url: 'https://github.com/owner/repo/issues/15',
    createdAt: '2026-01-26T10:00:00Z',
    updatedAt: '2026-01-26T10:00:00Z',
    labels: [],
    author: { login: 'user' },
    ...overrides,
  };
}

function createMockLinkedIssue(number: number, title: string): IGitHubIssue {
  return {
    type: 'issue',
    number,
    repo: 'owner/repo',
    title,
    status: 'open',
    url: `https://github.com/owner/repo/issues/${number}`,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrLinkHandler', () => {
  let handler: PrLinkHandler;
  let mockGithubClient: GithubClient;
  let mockPrRepository: IPullRequestRepository;

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockPrRepository = createMockPrRepository();
    handler = new PrLinkHandler(mockGithubClient, mockPrRepository);
  });

  describe('execute', () => {
    it('should successfully link PR to issue', async () => {
      const result = await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.alreadyLinked, false);
      assert.strictEqual(result.message, 'Linked PR #50 to Issue #15');
      assert.strictEqual(result.pr?.number, 50);
      assert.strictEqual(result.issue?.number, 15);
    });

    it('should use provided repo instead of detecting', async () => {
      let usedRepo: string | undefined;
      mockGithubClient = createMockGithubClient({
        getPr: async (repo) => {
          usedRepo = repo;
          return createMockPrResponse();
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
        repo: 'custom/repo',
      });

      assert.strictEqual(usedRepo, 'custom/repo');
    });

    it('should return alreadyLinked=true when issue already linked', async () => {
      mockPrRepository = createMockPrRepository({
        findIssuesByPr: async () => [createMockLinkedIssue(15, 'Already Linked')],
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.alreadyLinked, true);
      assert.ok(result.message.includes('already linked'));
    });

    it('should preserve existing linked issues when adding new one', async () => {
      const linkedIssues: number[] = [];
      mockPrRepository = createMockPrRepository({
        findIssuesByPr: async () => [
          createMockLinkedIssue(10, 'Existing Issue 1'),
          createMockLinkedIssue(12, 'Existing Issue 2'),
        ],
        linkPrToIssues: async (_userId, _repo, _prNumber, issueNumbers) => {
          linkedIssues.push(...issueNumbers);
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      // Should include existing issues (10, 12) plus new one (15)
      assert.deepStrictEqual(linkedIssues.sort(), [10, 12, 15]);
    });

    it('should create PR node if not exists', async () => {
      let prUpserted = false;
      mockPrRepository = createMockPrRepository({
        findPr: async () => null,
        upsertPr: async () => {
          prUpserted = true;
          return { type: 'pull_request', number: 50, repo: 'owner/repo', title: 'Test PR', status: 'open', watching: false, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(prUpserted, true);
    });

    it('should not create PR node if already exists', async () => {
      let prUpserted = false;
      mockPrRepository = createMockPrRepository({
        findPr: async () => ({ type: 'pull_request', number: 50, repo: 'owner/repo', title: 'Existing PR', status: 'open', watching: false, checksStatus: 'pending', unresolvedComments: 0 }),
        upsertPr: async () => {
          prUpserted = true;
          return { type: 'pull_request', number: 50, repo: 'owner/repo', title: 'Test PR', status: 'open', watching: false, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(prUpserted, false);
    });

    it('should return failure when PR does not exist on GitHub', async () => {
      mockGithubClient = createMockGithubClient({
        getPr: async () => {
          throw new Error('PR not found');
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({
        prNumber: 999,
        issueNumber: 15,
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed to link'));
    });

    it('should return failure when Issue does not exist on GitHub', async () => {
      mockGithubClient = createMockGithubClient({
        getIssue: async () => {
          throw new Error('Issue not found');
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({
        prNumber: 50,
        issueNumber: 999,
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed to link'));
    });

    it('should comment on GitHub issue by default', async () => {
      let commentedIssue: number | undefined;
      let commentBody: string | undefined;
      mockGithubClient = createMockGithubClient({
        commentOnIssue: async (_repo, issueNumber, body) => {
          commentedIssue = issueNumber;
          commentBody = body;
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(commentedIssue, 15);
      assert.ok(commentBody?.includes('PR #50'));
    });

    it('should skip GitHub comment when noComment=true', async () => {
      let commented = false;
      mockGithubClient = createMockGithubClient({
        commentOnIssue: async () => {
          commented = true;
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
        noComment: true,
      });

      assert.strictEqual(commented, false);
    });

    it('should skip GitHub comment when already linked', async () => {
      let commented = false;
      mockGithubClient = createMockGithubClient({
        commentOnIssue: async () => {
          commented = true;
        },
      });
      mockPrRepository = createMockPrRepository({
        findIssuesByPr: async () => [createMockLinkedIssue(15, 'Already Linked')],
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(commented, false);
    });

    it('should succeed even if comment fails', async () => {
      mockGithubClient = createMockGithubClient({
        commentOnIssue: async () => {
          throw new Error('Comment failed');
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      // Link should still succeed even if comment fails
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.alreadyLinked, false);
    });

    it('should handle Neo4j errors gracefully', async () => {
      mockPrRepository = createMockPrRepository({
        linkPrToIssues: async () => {
          throw new Error('Neo4j connection failed');
        },
      });
      handler = new PrLinkHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({
        prNumber: 50,
        issueNumber: 15,
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Neo4j connection failed'));
    });
  });
});
