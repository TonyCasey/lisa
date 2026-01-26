/**
 * Tests for Neo4jPullRequestRepository.
 *
 * Tests the PR repository implementation using mocked Neo4j connection.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import type {
  IPullRequest,
  IGitHubIssue,
  IPrCheck,
  IPrComment,
} from '../../../../../../../../src/lib/domain/interfaces/types/IPullRequest';
import type {
  IPullRequestRepository,
} from '../../../../../../../../src/lib/domain/interfaces/dal/IPullRequestRepository';

/**
 * Mock Neo4j connection manager for testing.
 */
interface MockNeo4jConnectionManager {
  query: <T>(cypher: string, params?: Record<string, unknown>) => Promise<T[]>;
  write: (cypher: string, params?: Record<string, unknown>) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => Promise<boolean>;
}

/**
 * Create a mock repository implementation for testing the interface contract.
 */
function createMockRepository(
  mockConnection: MockNeo4jConnectionManager
): IPullRequestRepository {
  let cachedUserId: string | null = null;

  const generatePrUuid = (repo: string, prNumber: number): string => {
    const repoSlug = repo.replace('/', '-');
    return `pr-${repoSlug}-${prNumber}`;
  };

  const generateIssueUuid = (repo: string, issueNumber: number): string => {
    const repoSlug = repo.replace('/', '-');
    return `issue-${repoSlug}-${issueNumber}`;
  };

  const generatePrName = (repo: string, prNumber: number): string => {
    return `PR:${repo}#${prNumber}`;
  };

  const generateIssueName = (repo: string, issueNumber: number): string => {
    return `ISSUE:${repo}#${issueNumber}`;
  };

  return {
    supportsWrite: () => true,
    supportsRelationships: () => true,

    async getUserId(): Promise<string> {
      if (cachedUserId) return cachedUserId;
      // In tests, return a fixed user ID
      cachedUserId = 'user:test-user';
      return cachedUserId;
    },

    async findPr(userId, repo, prNumber) {
      const uuid = generatePrUuid(repo, prNumber);
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { uuid, userId });

      if (records.length === 0) return null;

      const content = JSON.parse(records[0].content) as IPullRequest;
      return { ...content, uuid: records[0].uuid, created_at: records[0].created_at };
    },

    async findWatchedPrs(userId, options) {
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { userId });

      const items = records.map(r => {
        const content = JSON.parse(r.content) as IPullRequest;
        return { ...content, uuid: r.uuid, created_at: r.created_at };
      });

      return { items, hasMore: false };
    },

    async findIssue(userId, repo, issueNumber) {
      const uuid = generateIssueUuid(repo, issueNumber);
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { uuid, userId });

      if (records.length === 0) return null;

      const content = JSON.parse(records[0].content) as IGitHubIssue;
      return { ...content, uuid: records[0].uuid, created_at: records[0].created_at };
    },

    async findIssuesByPr(userId, repo, prNumber) {
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { userId });

      return records.map(r => {
        const content = JSON.parse(r.content) as IGitHubIssue;
        return { ...content, uuid: r.uuid, created_at: r.created_at };
      });
    },

    async findPrsByIssue(userId, repo, issueNumber) {
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { userId });

      return records.map(r => {
        const content = JSON.parse(r.content) as IPullRequest;
        return { ...content, uuid: r.uuid, created_at: r.created_at };
      });
    },

    async findChecksByPr(userId, repo, prNumber) {
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
        created_at?: string;
      }>('', { userId });

      return records.map(r => {
        const content = JSON.parse(r.content) as IPrCheck;
        return { ...content, uuid: r.uuid, created_at: r.created_at };
      });
    },

    async findCommentsByPr(userId, repo, prNumber) {
      const records = await mockConnection.query<{
        uuid: string;
        content: string;
      }>('', { userId });

      return records.map(r => {
        const content = JSON.parse(r.content) as IPrComment;
        return { ...content, uuid: r.uuid };
      });
    },

    async getPrWithRelations(userId, repo, prNumber) {
      const pr = await this.findPr(userId, repo, prNumber);
      if (!pr) return null;

      const [issues, checks, comments] = await Promise.all([
        this.findIssuesByPr(userId, repo, prNumber),
        this.findChecksByPr(userId, repo, prNumber),
        this.findCommentsByPr(userId, repo, prNumber),
      ]);

      return { pr, issues, checks, comments };
    },

    async upsertPr(userId, input) {
      const uuid = generatePrUuid(input.repo, input.number);
      const now = new Date().toISOString();

      const pr: IPullRequest = {
        type: 'pull_request',
        number: input.number,
        repo: input.repo,
        title: input.title,
        status: input.status ?? 'open',
        watching: input.watching ?? true,
        watchingSince: input.watching !== false ? now : undefined,
        checksStatus: 'pending',
        unresolvedComments: 0,
        uuid,
        created_at: now,
      };

      await mockConnection.write('', { uuid, content: JSON.stringify(pr), userId });
      return pr;
    },

    async upsertIssue(userId, input) {
      const uuid = generateIssueUuid(input.repo, input.number);
      const now = new Date().toISOString();

      const issue: IGitHubIssue = {
        type: 'issue',
        number: input.number,
        repo: input.repo,
        title: input.title,
        status: input.status ?? 'open',
        url: input.url,
        uuid,
        created_at: now,
      };

      await mockConnection.write('', { uuid, content: JSON.stringify(issue), userId });
      return issue;
    },

    async upsertCheck(userId, repo, prNumber, checkData) {
      const now = new Date().toISOString();
      const uuid = `prcheck-${repo.replace('/', '-')}-${prNumber}-${checkData.checkName}`;

      const check: IPrCheck = {
        type: 'pr_check',
        ...checkData,
        uuid,
        created_at: now,
      };

      await mockConnection.write('', { uuid, content: JSON.stringify(check), userId });
      return check;
    },

    async upsertComment(userId, repo, prNumber, commentData) {
      const uuid = `prcomment-${repo.replace('/', '-')}-${commentData.commentId}`;

      const comment: IPrComment = {
        type: 'pr_comment',
        ...commentData,
        uuid,
      };

      await mockConnection.write('', { uuid, content: JSON.stringify(comment), userId });
      return comment;
    },

    async linkPrToIssues(userId, repo, prNumber, issueNumbers) {
      await mockConnection.write('', { userId, repo, prNumber, issueNumbers });
    },

    async setWatching(userId, repo, prNumber, watching) {
      await mockConnection.write('', { userId, repo, prNumber, watching });
    },

    async updateLastPolled(userId, repo, prNumber) {
      await mockConnection.write('', { userId, repo, prNumber });
    },

    async deletePr(userId, repo, prNumber) {
      await mockConnection.write('', { userId, repo, prNumber });
    },
  };
}

describe('Neo4jPullRequestRepository', () => {
  let mockConnection: MockNeo4jConnectionManager;
  let repo: IPullRequestRepository;
  let queryResults: unknown[];
  let writeCalls: Array<{ cypher: string; params?: Record<string, unknown> }>;

  beforeEach(() => {
    queryResults = [];
    writeCalls = [];

    mockConnection = {
      query: async <T>(_cypher: string, _params?: Record<string, unknown>): Promise<T[]> => {
        return queryResults as T[];
      },
      write: async (cypher: string, params?: Record<string, unknown>): Promise<void> => {
        writeCalls.push({ cypher, params });
      },
      connect: async () => {},
      disconnect: async () => {},
      isConnected: async () => true,
    };

    repo = createMockRepository(mockConnection);
  });

  describe('supportsWrite()', () => {
    it('should return true', () => {
      assert.strictEqual(repo.supportsWrite(), true);
    });
  });

  describe('supportsRelationships()', () => {
    it('should return true', () => {
      assert.strictEqual(repo.supportsRelationships(), true);
    });
  });

  describe('getUserId()', () => {
    it('should return user ID in expected format', async () => {
      const userId = await repo.getUserId();
      assert.ok(userId.startsWith('user:'));
    });

    it('should cache the user ID', async () => {
      const userId1 = await repo.getUserId();
      const userId2 = await repo.getUserId();
      assert.strictEqual(userId1, userId2);
    });
  });

  describe('findPr()', () => {
    it('should return null when PR not found', async () => {
      queryResults = [];
      const result = await repo.findPr('user:test', 'owner/repo', 42);
      assert.strictEqual(result, null);
    });

    it('should return PR when found', async () => {
      const prContent: IPullRequest = {
        type: 'pull_request',
        number: 42,
        repo: 'owner/repo',
        title: 'Test PR',
        status: 'open',
        watching: true,
        checksStatus: 'pending',
        unresolvedComments: 0,
      };

      queryResults = [{
        uuid: 'pr-owner-repo-42',
        content: JSON.stringify(prContent),
        created_at: '2026-01-26T00:00:00Z',
      }];

      const result = await repo.findPr('user:test', 'owner/repo', 42);

      assert.ok(result);
      assert.strictEqual(result.number, 42);
      assert.strictEqual(result.repo, 'owner/repo');
      assert.strictEqual(result.title, 'Test PR');
      assert.strictEqual(result.uuid, 'pr-owner-repo-42');
    });
  });

  describe('findWatchedPrs()', () => {
    it('should return empty result when no PRs', async () => {
      queryResults = [];
      const result = await repo.findWatchedPrs('user:test');
      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.hasMore, false);
    });

    it('should return watched PRs', async () => {
      const prContent: IPullRequest = {
        type: 'pull_request',
        number: 42,
        repo: 'owner/repo',
        title: 'Test PR',
        status: 'open',
        watching: true,
        checksStatus: 'pending',
        unresolvedComments: 0,
      };

      queryResults = [{
        uuid: 'pr-owner-repo-42',
        content: JSON.stringify(prContent),
        created_at: '2026-01-26T00:00:00Z',
      }];

      const result = await repo.findWatchedPrs('user:test');

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].number, 42);
    });
  });

  describe('upsertPr()', () => {
    it('should create a PR and call write', async () => {
      const result = await repo.upsertPr('user:test', {
        number: 42,
        repo: 'owner/repo',
        title: 'New PR',
      });

      assert.strictEqual(result.type, 'pull_request');
      assert.strictEqual(result.number, 42);
      assert.strictEqual(result.repo, 'owner/repo');
      assert.strictEqual(result.title, 'New PR');
      assert.strictEqual(result.status, 'open');
      assert.strictEqual(result.watching, true);
      assert.ok(result.uuid);
      assert.ok(result.created_at);
      assert.strictEqual(writeCalls.length, 1);
    });

    it('should respect custom status and watching', async () => {
      const result = await repo.upsertPr('user:test', {
        number: 42,
        repo: 'owner/repo',
        title: 'Merged PR',
        status: 'merged',
        watching: false,
      });

      assert.strictEqual(result.status, 'merged');
      assert.strictEqual(result.watching, false);
      assert.strictEqual(result.watchingSince, undefined);
    });
  });

  describe('upsertIssue()', () => {
    it('should create an issue and call write', async () => {
      const result = await repo.upsertIssue('user:test', {
        number: 15,
        repo: 'owner/repo',
        title: 'Bug report',
        url: 'https://github.com/owner/repo/issues/15',
      });

      assert.strictEqual(result.type, 'issue');
      assert.strictEqual(result.number, 15);
      assert.strictEqual(result.repo, 'owner/repo');
      assert.strictEqual(result.title, 'Bug report');
      assert.strictEqual(result.status, 'open');
      assert.ok(result.uuid);
      assert.strictEqual(writeCalls.length, 1);
    });
  });

  describe('upsertCheck()', () => {
    it('should create a check and call write', async () => {
      const result = await repo.upsertCheck('user:test', 'owner/repo', 42, {
        checkName: 'ci/build',
        status: 'success',
        updatedAt: '2026-01-26T00:00:00Z',
      });

      assert.strictEqual(result.type, 'pr_check');
      assert.strictEqual(result.checkName, 'ci/build');
      assert.strictEqual(result.status, 'success');
      assert.ok(result.uuid);
      assert.strictEqual(writeCalls.length, 1);
    });
  });

  describe('upsertComment()', () => {
    it('should create a comment and call write', async () => {
      const result = await repo.upsertComment('user:test', 'owner/repo', 42, {
        commentId: '12345',
        file: 'src/index.ts',
        line: 10,
        author: 'reviewer',
        body: 'Please fix this',
        status: 'pending',
        hasNewReply: false,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      });

      assert.strictEqual(result.type, 'pr_comment');
      assert.strictEqual(result.commentId, '12345');
      assert.strictEqual(result.file, 'src/index.ts');
      assert.strictEqual(result.author, 'reviewer');
      assert.ok(result.uuid);
      assert.strictEqual(writeCalls.length, 1);
    });
  });

  describe('linkPrToIssues()', () => {
    it('should call write to create relationships', async () => {
      await repo.linkPrToIssues('user:test', 'owner/repo', 42, [15, 16]);

      assert.strictEqual(writeCalls.length, 1);
      assert.deepStrictEqual(writeCalls[0].params?.issueNumbers, [15, 16]);
    });
  });

  describe('setWatching()', () => {
    it('should call write to update watching status', async () => {
      await repo.setWatching('user:test', 'owner/repo', 42, false);

      assert.strictEqual(writeCalls.length, 1);
      assert.strictEqual(writeCalls[0].params?.watching, false);
    });
  });

  describe('deletePr()', () => {
    it('should call write to delete PR', async () => {
      await repo.deletePr('user:test', 'owner/repo', 42);

      assert.strictEqual(writeCalls.length, 1);
    });
  });

  describe('getPrWithRelations()', () => {
    it('should return null when PR not found', async () => {
      queryResults = [];
      const result = await repo.getPrWithRelations('user:test', 'owner/repo', 42);
      assert.strictEqual(result, null);
    });

    it('should return PR with all relations', async () => {
      const prContent: IPullRequest = {
        type: 'pull_request',
        number: 42,
        repo: 'owner/repo',
        title: 'Test PR',
        status: 'open',
        watching: true,
        checksStatus: 'pending',
        unresolvedComments: 0,
      };

      // Set up mock to return PR on first call
      let callCount = 0;
      mockConnection.query = async <T>(): Promise<T[]> => {
        callCount++;
        if (callCount === 1) {
          // PR query
          return [{
            uuid: 'pr-owner-repo-42',
            content: JSON.stringify(prContent),
            created_at: '2026-01-26T00:00:00Z',
          }] as T[];
        }
        // Issues, checks, comments queries
        return [] as T[];
      };

      const result = await repo.getPrWithRelations('user:test', 'owner/repo', 42);

      assert.ok(result);
      assert.strictEqual(result.pr.number, 42);
      assert.ok(Array.isArray(result.issues));
      assert.ok(Array.isArray(result.checks));
      assert.ok(Array.isArray(result.comments));
    });
  });
});
