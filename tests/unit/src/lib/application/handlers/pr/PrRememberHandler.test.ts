/**
 * Tests for PrRememberHandler
 *
 * Tests saving PR notes to memory with appropriate tags.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PrRememberHandler } from '../../../../../../../src/lib/application/handlers/pr/PrRememberHandler';
import type { GithubClient } from '../../../../../../../src/lib/infrastructure/github';
import type { IMemoryWriter } from '../../../../../../../src/lib/domain/interfaces/IMemoryService';
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
    getIssue: async () => null,
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

function createMockMemoryWriter(overrides: Partial<IMemoryWriter> = {}): IMemoryWriter {
  return {
    saveMemory: async () => {},
    addFact: async () => {},
    ...overrides,
  };
}

function createMockPrResponse(overrides: Partial<IGhPrResponse> = {}): IGhPrResponse {
  return {
    number: 50,
    title: 'Test PR Title',
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

// ============================================================================
// Tests
// ============================================================================

describe('PrRememberHandler', () => {
  let handler: PrRememberHandler;
  let mockGithubClient: GithubClient;
  let mockMemoryWriter: IMemoryWriter;
  const groupId = 'test-group-id';

  beforeEach(() => {
    mockGithubClient = createMockGithubClient();
    mockMemoryWriter = createMockMemoryWriter();
    handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);
  });

  describe('execute', () => {
    it('should successfully save note about a PR', async () => {
      const result = await handler.execute({
        prNumber: 50,
        note: 'Learned to always reply inline to review comments',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'Saved note for PR #50');
      assert.strictEqual(result.pr?.number, 50);
      assert.strictEqual(result.pr?.title, 'Test PR Title');
      assert.strictEqual(result.pr?.repo, 'owner/repo');
    });

    it('should include PR title in the saved fact', async () => {
      let savedFact: string | undefined;
      mockMemoryWriter = createMockMemoryWriter({
        addFact: async (_groupId, fact) => {
          savedFact = fact;
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      await handler.execute({
        prNumber: 50,
        note: 'Important learning',
      });

      assert.ok(savedFact);
      assert.ok(savedFact.includes('PR #50'));
      assert.ok(savedFact.includes('Test PR Title'));
      assert.ok(savedFact.includes('Important learning'));
    });

    it('should save fact with correct tags', async () => {
      let savedTags: readonly string[] | undefined;
      mockMemoryWriter = createMockMemoryWriter({
        addFact: async (_groupId, _fact, tags) => {
          savedTags = tags;
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.ok(savedTags);
      assert.ok(savedTags.includes('github:pr'));
      assert.ok(savedTags.includes('github:pr:50'));
      assert.deepStrictEqual(result.tags, ['github:pr', 'github:pr:50']);
    });

    it('should save to the correct group ID', async () => {
      let usedGroupId: string | undefined;
      mockMemoryWriter = createMockMemoryWriter({
        addFact: async (gId) => {
          usedGroupId = gId;
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.strictEqual(usedGroupId, groupId);
    });

    it('should use provided repo instead of detecting', async () => {
      let usedRepo: string | undefined;
      mockGithubClient = createMockGithubClient({
        getPr: async (repo) => {
          usedRepo = repo;
          return createMockPrResponse();
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      await handler.execute({
        prNumber: 50,
        repo: 'custom/repo',
        note: 'Test note',
      });

      assert.strictEqual(usedRepo, 'custom/repo');
    });

    it('should return error when PR not found', async () => {
      mockGithubClient = createMockGithubClient({
        getPr: async () => null as unknown as IGhPrResponse,
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 999,
        note: 'Test note',
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('PR #999 not found'));
    });

    it('should return error when GitHub client throws', async () => {
      mockGithubClient = createMockGithubClient({
        getPr: async () => {
          throw new Error('GitHub API error');
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('GitHub API error'));
    });

    it('should return error when memory service throws', async () => {
      mockMemoryWriter = createMockMemoryWriter({
        addFact: async () => {
          throw new Error('Memory save failed');
        },
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Memory save failed'));
    });

    it('should return the saved fact in the result', async () => {
      const result = await handler.execute({
        prNumber: 50,
        note: 'Learned something important',
      });

      assert.ok(result.fact);
      assert.strictEqual(result.fact, 'PR #50 (Test PR Title): Learned something important');
    });

    it('should detect current repo when not provided', async () => {
      let detectedRepo = false;
      mockGithubClient = createMockGithubClient({
        getCurrentRepo: async () => {
          detectedRepo = true;
          return 'detected/repo';
        },
        getPr: async () => createMockPrResponse(),
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.strictEqual(detectedRepo, true);
      assert.strictEqual(result.pr?.repo, 'detected/repo');
    });

    it('should return error when repo cannot be determined', async () => {
      mockGithubClient = createMockGithubClient({
        getCurrentRepo: async () => undefined as unknown as string,
      });
      handler = new PrRememberHandler(mockGithubClient, mockMemoryWriter, groupId);

      const result = await handler.execute({
        prNumber: 50,
        note: 'Test note',
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Could not determine repository'));
    });
  });
});
