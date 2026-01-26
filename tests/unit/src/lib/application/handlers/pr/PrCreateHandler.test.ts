/**
 * Tests for PrCreateHandler
 *
 * Tests PR creation with auto-generated body, issue linking, and auto-watch.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrCreateHandler } from '../../../../../../../src/lib/application/handlers/pr/PrCreateHandler';
import type { IGithubClient } from '../../../../../../../src/lib/domain/interfaces/dal/IGithubClient';
import type { IPullRequestRepository } from '../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';
import type { IGhPrResponse, IGhIssueResponse } from '../../../../../../../src/lib/infrastructure/github/types';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockGithubClient(overrides: Partial<IGithubClient> = {}): IGithubClient {
  return {
    getCurrentRepo: async () => 'owner/repo',
    getCurrentBranch: async () => 'feature/40-pr-create',
    getDefaultBranch: async () => 'main',
    getCommitMessages: async () => ['feat: add pr create command', 'fix: handle edge case'],
    getChangedFiles: async () => ['src/handler.ts', 'tests/handler.test.ts'],
    getPr: async () => createMockPrResponse(),
    getPrChecks: async () => [],
    getPrComments: async () => [],
    getPrDiff: async () => '',
    getIssue: async () => createMockIssueResponse(40),
    replyToComment: async () => ({ id: 1, user: { login: 'user' }, body: '', path: '', diff_hunk: '', created_at: '', updated_at: '', html_url: '' }),
    addReaction: async () => {},
    getCurrentUser: async () => ({ login: 'user', id: 1 }),
    getUserId: async () => 'user:test',
    createPr: async () => createMockPrResponse(),
    commentOnIssue: async () => {},
    isAvailable: async () => true,
    ...overrides,
  } as IGithubClient;
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
    number: 51,
    title: 'feat: add pr create command',
    state: 'OPEN',
    body: 'PR body',
    headRefName: 'feature/40-pr-create',
    baseRefName: 'main',
    url: 'https://github.com/owner/repo/pull/51',
    isDraft: false,
    mergeable: 'MERGEABLE',
    createdAt: '2026-01-26T10:00:00Z',
    updatedAt: '2026-01-26T10:00:00Z',
    author: { login: 'user' },
    repository: { nameWithOwner: 'owner/repo' },
    ...overrides,
  };
}

function createMockIssueResponse(number: number): IGhIssueResponse {
  return {
    number,
    title: `Issue #${number}: Implement feature`,
    state: 'OPEN',
    body: 'Issue description',
    url: `https://github.com/owner/repo/issues/${number}`,
    createdAt: '2026-01-20T10:00:00Z',
    updatedAt: '2026-01-25T10:00:00Z',
    labels: [],
    author: { login: 'user' },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrCreateHandler', () => {
  let handler: PrCreateHandler;
  let mockGithubClient: IGithubClient;
  let mockPrRepository: IPullRequestRepository;

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockPrRepository = createMockPrRepository();
    handler = new PrCreateHandler(mockGithubClient, mockPrRepository);
  });

  describe('execute', () => {
    it('should create a PR successfully', async () => {
      const result = await handler.execute();

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('Created PR #51'));
      assert.strictEqual(result.pr?.number, 51);
      assert.strictEqual(result.pr?.repo, 'owner/repo');
    });

    it('should use provided title', async () => {
      let capturedTitle: string | undefined;
      mockGithubClient = createMockGithubClient({
        createPr: async (opts) => {
          capturedTitle = opts.title;
          return createMockPrResponse({ title: opts.title });
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ title: 'Custom PR Title' });

      assert.strictEqual(capturedTitle, 'Custom PR Title');
    });

    it('should use issue title when no title provided', async () => {
      let capturedTitle: string | undefined;
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
        getIssue: async () => createMockIssueResponse(40),
        createPr: async (opts) => {
          capturedTitle = opts.title;
          return createMockPrResponse({ title: opts.title });
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.strictEqual(capturedTitle, 'Issue #40: Implement feature');
    });

    it('should use first commit message when no title or issue', async () => {
      let capturedTitle: string | undefined;
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'no-issue-branch',
        getIssue: async () => { throw new Error('Not found'); },
        getCommitMessages: async () => ['feat: first commit', 'fix: second commit'],
        createPr: async (opts) => {
          capturedTitle = opts.title;
          return createMockPrResponse({ title: opts.title });
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.strictEqual(capturedTitle, 'feat: first commit');
    });

    it('should use provided base branch', async () => {
      let capturedBase: string | undefined;
      mockGithubClient = createMockGithubClient({
        createPr: async (opts) => {
          capturedBase = opts.base;
          return createMockPrResponse();
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ base: 'develop' });

      assert.strictEqual(capturedBase, 'develop');
    });

    it('should auto-detect default branch when base not provided', async () => {
      let capturedBase: string | undefined;
      mockGithubClient = createMockGithubClient({
        getDefaultBranch: async () => 'master',
        createPr: async (opts) => {
          capturedBase = opts.base;
          return createMockPrResponse();
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.strictEqual(capturedBase, 'master');
    });

    it('should create draft PR when draft option is true', async () => {
      let capturedDraft: boolean | undefined;
      mockGithubClient = createMockGithubClient({
        createPr: async (opts) => {
          capturedDraft = opts.draft;
          return createMockPrResponse({ isDraft: true });
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ draft: true });

      assert.strictEqual(capturedDraft, true);
    });

    it('should comment on linked issues by default', async () => {
      const commentedIssues: number[] = [];
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
        commentOnIssue: async (_repo, issueNumber) => {
          commentedIssues.push(issueNumber);
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.deepStrictEqual(commentedIssues, [40]);
    });

    it('should skip commenting when noComment is true', async () => {
      const commentedIssues: number[] = [];
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
        commentOnIssue: async (_repo, issueNumber) => {
          commentedIssues.push(issueNumber);
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ noComment: true });

      assert.strictEqual(commentedIssues.length, 0);
    });

    it('should auto-watch PR by default', async () => {
      let watchCalled = false;
      mockPrRepository = createMockPrRepository({
        upsertPr: async () => {
          watchCalled = true;
          return { type: 'pull_request', number: 51, repo: 'owner/repo', title: 'PR', status: 'open', watching: true, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.strictEqual(watchCalled, true);
    });

    it('should skip watching when noWatch is true', async () => {
      let watchCalled = false;
      mockPrRepository = createMockPrRepository({
        upsertPr: async () => {
          watchCalled = true;
          return { type: 'pull_request', number: 51, repo: 'owner/repo', title: 'PR', status: 'open', watching: true, checksStatus: 'pending', unresolvedComments: 0 };
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute({ noWatch: true });

      assert.strictEqual(watchCalled, false);
    });

    it('should create Neo4j relationships for linked issues', async () => {
      let linkedIssues: number[] = [];
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
      });
      mockPrRepository = createMockPrRepository({
        linkPrToIssues: async (_userId, _repo, _prNumber, issues) => {
          linkedIssues = [...issues];
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      await handler.execute();

      assert.deepStrictEqual(linkedIssues, [40]);
    });

    it('should return linked issues in result', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [40]);
    });

    it('should return failure on error', async () => {
      mockGithubClient = createMockGithubClient({
        createPr: async () => { throw new Error('API error'); },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed to create PR'));
      assert.ok(result.message.includes('API error'));
    });

    it('should use explicitly provided issues', async () => {
      const linkedIssues: number[] = [];
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'no-issue-branch',
        getIssue: async (_, num) => createMockIssueResponse(num),
        commentOnIssue: async (_repo, issueNumber) => {
          linkedIssues.push(issueNumber);
        },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute({ issues: [10, 20] });

      assert.deepStrictEqual(result.linkedIssues, [10, 20]);
      assert.deepStrictEqual(linkedIssues, [10, 20]);
    });
  });

  describe('parseIssuesFromBranch', () => {
    // Test branch name parsing through execute method by checking linkedIssues
    // Each test overrides getIssue to return the correct issue for the parsed number

    it('should parse issue from "15" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '15',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should parse issue from "15-description" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '15-add-feature',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should parse issue from "feature/15" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'feature/15',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should parse issue from "feature/15-description" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'feature/15-add-feature',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should parse issue from "issue-15" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'issue-15',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should parse issue from "fix/#15" branch name', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'fix/#15',
        getIssue: async (_, num) => createMockIssueResponse(num),
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, [15]);
    });

    it('should return no issues for branch without number', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'feature-branch',
        getIssue: async () => { throw new Error('Not found'); },
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.deepStrictEqual(result.linkedIssues, []);
    });
  });

  describe('generatePrBody', () => {
    // Test body generation through execute method by checking result.body

    it('should include Summary section with commits', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'no-issue-branch',
        getIssue: async () => { throw new Error('Not found'); },
        getCommitMessages: async () => ['feat: add feature', 'fix: bug fix'],
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.ok(result.body?.includes('## Summary'));
      assert.ok(result.body?.includes('- feat: add feature'));
      assert.ok(result.body?.includes('- fix: bug fix'));
    });

    it('should include Test Coverage section for test files', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'no-issue-branch',
        getIssue: async () => { throw new Error('Not found'); },
        getChangedFiles: async () => ['src/handler.ts', 'tests/handler.test.ts', 'src/__tests__/foo.ts'],
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.ok(result.body?.includes('## Test Coverage'));
      assert.ok(result.body?.includes('tests/handler.test.ts'));
      assert.ok(result.body?.includes('src/__tests__/foo.ts'));
    });

    it('should include Linked Issues section with Closes syntax', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => '40-feature',
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.ok(result.body?.includes('## Linked Issues'));
      assert.ok(result.body?.includes('Closes #40'));
    });

    it('should limit commits to 10 in Summary', async () => {
      const commits = Array.from({ length: 15 }, (_, i) => `commit ${i + 1}`);
      mockGithubClient = createMockGithubClient({
        getCurrentBranch: async () => 'no-issue-branch',
        getIssue: async () => { throw new Error('Not found'); },
        getCommitMessages: async () => commits,
      });
      handler = new PrCreateHandler(mockGithubClient, mockPrRepository);

      const result = await handler.execute();

      assert.ok(result.body?.includes('- commit 1'));
      assert.ok(result.body?.includes('- commit 10'));
      assert.ok(!result.body?.includes('- commit 11'));
      assert.ok(result.body?.includes('... and 5 more commits'));
    });
  });
});
