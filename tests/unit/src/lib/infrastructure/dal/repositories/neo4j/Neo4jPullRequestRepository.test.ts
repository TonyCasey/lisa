/**
 * Tests for Neo4jPullRequestRepository.
 *
 * Tests the actual PR repository implementation with a mocked Neo4j connection.
 * This ensures the real class logic (UUID generation, Cypher queries, etc.) is tested.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Neo4jPullRequestRepository } from '../../../../../../../../src/lib/infrastructure/dal/repositories/neo4j/Neo4jPullRequestRepository';
import type {
  IPullRequest,
  IGitHubIssue,
  IPrCheck,
  IPrComment,
} from '../../../../../../../../src/lib/domain/interfaces/types/IPullRequest';

/**
 * Mock Neo4j connection manager that captures queries and returns configured results.
 */
interface MockNeo4jConnectionManager {
  query: <T>(cypher: string, params?: Record<string, unknown>) => Promise<T[]>;
  write: (cypher: string, params?: Record<string, unknown>) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => Promise<boolean>;
}

describe('Neo4jPullRequestRepository', () => {
  let mockConnection: MockNeo4jConnectionManager;
  let repo: Neo4jPullRequestRepository;
  let queryResults: unknown[];
  let queryCalls: Array<{ cypher: string; params?: Record<string, unknown> }>;
  let writeCalls: Array<{ cypher: string; params?: Record<string, unknown> }>;

  beforeEach(() => {
    queryResults = [];
    queryCalls = [];
    writeCalls = [];

    mockConnection = {
      query: async <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> => {
        queryCalls.push({ cypher, params });
        return queryResults as T[];
      },
      write: async (cypher: string, params?: Record<string, unknown>): Promise<void> => {
        writeCalls.push({ cypher, params });
      },
      connect: async () => {},
      disconnect: async () => {},
      isConnected: async () => true,
    };

    // Cast to satisfy the constructor - the mock implements the interface we need
    repo = new Neo4jPullRequestRepository(mockConnection as never);
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
      // Either returns actual git user or fallback
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

    it('should generate correct UUID for query', async () => {
      queryResults = [];
      await repo.findPr('user:test', 'owner/repo', 42);
      
      assert.strictEqual(queryCalls.length, 1);
      assert.strictEqual(queryCalls[0].params?.uuid, 'pr-owner-repo-42');
      assert.strictEqual(queryCalls[0].params?.userId, 'user:test');
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
        name: 'PR:owner/repo#42',
        content: JSON.stringify(prContent),
        group_id: 'user:test',
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

    it('should use parameterized query to prevent injection', async () => {
      queryResults = [];
      await repo.findWatchedPrs('user:test', { repo: 'evil/repo"; DROP TABLE' });

      assert.strictEqual(queryCalls.length, 1);
      // Verify params are used instead of string interpolation
      assert.ok(queryCalls[0].params?.userId);
      assert.ok(queryCalls[0].params?.offset !== undefined);
      assert.ok(queryCalls[0].params?.fetchLimit !== undefined);
      assert.ok(queryCalls[0].params?.repoFilter);
      // Verify the cypher uses parameter placeholders
      assert.ok(queryCalls[0].cypher.includes('$offset'));
      assert.ok(queryCalls[0].cypher.includes('$fetchLimit'));
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
        name: 'PR:owner/repo#42',
        content: JSON.stringify(prContent),
        group_id: 'user:test',
        created_at: '2026-01-26T00:00:00Z',
      }];

      const result = await repo.findWatchedPrs('user:test');

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].number, 42);
    });

    it('should detect hasMore when results exceed limit', async () => {
      const makePr = (n: number): IPullRequest => ({
        type: 'pull_request',
        number: n,
        repo: 'owner/repo',
        title: `PR ${n}`,
        status: 'open',
        watching: true,
        checksStatus: 'pending',
        unresolvedComments: 0,
      });

      // Return limit + 1 results
      queryResults = [1, 2, 3].map(n => ({
        uuid: `pr-owner-repo-${n}`,
        name: `PR:owner/repo#${n}`,
        content: JSON.stringify(makePr(n)),
        group_id: 'user:test',
        created_at: '2026-01-26T00:00:00Z',
      }));

      const result = await repo.findWatchedPrs('user:test', { limit: 2 });

      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.hasMore, true);
    });
  });

  describe('upsertPr()', () => {
    it('should create a PR with correct defaults', async () => {
      // First query returns empty (no existing PR)
      queryResults = [];

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
      assert.strictEqual(result.checksStatus, 'pending');
      assert.strictEqual(result.unresolvedComments, 0);
      assert.ok(result.uuid);
      assert.ok(result.created_at);
      assert.ok(result.watchingSince);
      // Should have queried for existing + write
      assert.strictEqual(queryCalls.length, 1);
      assert.strictEqual(writeCalls.length, 1);
    });

    it('should preserve existing metadata on update', async () => {
      // Existing PR with metadata
      const existingPr: IPullRequest = {
        type: 'pull_request',
        number: 42,
        repo: 'owner/repo',
        title: 'Old Title',
        status: 'open',
        watching: false,
        watchingSince: '2026-01-01T00:00:00Z',
        lastPolled: '2026-01-25T00:00:00Z',
        checksStatus: 'success',
        unresolvedComments: 3,
        uuid: 'pr-owner-repo-42',
        created_at: '2026-01-01T00:00:00Z',
      };

      queryResults = [{
        uuid: 'pr-owner-repo-42',
        name: 'PR:owner/repo#42',
        content: JSON.stringify(existingPr),
        group_id: 'user:test',
        created_at: '2026-01-01T00:00:00Z',
      }];

      // Update just the title (no watching specified)
      const result = await repo.upsertPr('user:test', {
        number: 42,
        repo: 'owner/repo',
        title: 'Updated Title',
      });

      // Should preserve existing metadata
      assert.strictEqual(result.title, 'Updated Title');
      assert.strictEqual(result.watching, false); // Preserved
      assert.strictEqual(result.watchingSince, '2026-01-01T00:00:00Z'); // Preserved
      assert.strictEqual(result.lastPolled, '2026-01-25T00:00:00Z'); // Preserved
      assert.strictEqual(result.checksStatus, 'success'); // Preserved
      assert.strictEqual(result.unresolvedComments, 3); // Preserved
      assert.strictEqual(result.created_at, '2026-01-01T00:00:00Z'); // Preserved
    });

    it('should respect explicit watching=false', async () => {
      queryResults = [];

      const result = await repo.upsertPr('user:test', {
        number: 42,
        repo: 'owner/repo',
        title: 'New PR',
        watching: false,
      });

      assert.strictEqual(result.watching, false);
      assert.strictEqual(result.watchingSince, undefined);
    });

    it('should generate correct UUID format', async () => {
      queryResults = [];

      const result = await repo.upsertPr('user:test', {
        number: 42,
        repo: 'owner/repo',
        title: 'Test',
      });

      assert.strictEqual(result.uuid, 'pr-owner-repo-42');
    });
  });

  describe('upsertIssue()', () => {
    it('should create an issue with correct defaults', async () => {
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
      assert.strictEqual(result.uuid, 'issue-owner-repo-15');
      assert.strictEqual(writeCalls.length, 1);
    });
  });

  describe('upsertCheck()', () => {
    it('should create a check and link to PR', async () => {
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
      // Verify the cypher creates the HAS_CHECK relationship
      assert.ok(writeCalls[0].cypher.includes('HAS_CHECK'));
    });

    it('should generate unique UUIDs for similarly named checks', async () => {
      // Test that ci/build and ci-build produce different UUIDs
      const result1 = await repo.upsertCheck('user:test', 'owner/repo', 42, {
        checkName: 'ci/build',
        status: 'success',
        updatedAt: '2026-01-26T00:00:00Z',
      });

      const result2 = await repo.upsertCheck('user:test', 'owner/repo', 42, {
        checkName: 'ci-build',
        status: 'success',
        updatedAt: '2026-01-26T00:00:00Z',
      });

      // UUIDs should be different (base64url encoding preserves the difference)
      assert.notStrictEqual(result1.uuid, result2.uuid);
    });
  });

  describe('upsertComment()', () => {
    it('should create a comment and link to PR', async () => {
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
      assert.strictEqual(result.uuid, 'prcomment-owner-repo-12345');
      assert.strictEqual(writeCalls.length, 1);
      // Verify the cypher creates the HAS_COMMENT relationship
      assert.ok(writeCalls[0].cypher.includes('HAS_COMMENT'));
    });
  });

  describe('linkPrToIssues()', () => {
    it('should remove existing links and create new ones', async () => {
      await repo.linkPrToIssues('user:test', 'owner/repo', 42, [15, 16]);

      // Should have 3 write calls: 1 delete + 2 creates
      assert.strictEqual(writeCalls.length, 3);
      // First call removes existing CLOSES relationships
      assert.ok(writeCalls[0].cypher.includes('DELETE'));
      // Subsequent calls create new CLOSES relationships
      assert.ok(writeCalls[1].cypher.includes('CLOSES'));
      assert.ok(writeCalls[2].cypher.includes('CLOSES'));
    });
  });

  describe('setWatching()', () => {
    it('should throw when PR not found', async () => {
      queryResults = [];

      await assert.rejects(
        () => repo.setWatching('user:test', 'owner/repo', 42, false),
        /PR not found/
      );
    });

    it('should update watching status when PR exists', async () => {
      const existingPr: IPullRequest = {
        type: 'pull_request',
        number: 42,
        repo: 'owner/repo',
        title: 'Test PR',
        status: 'open',
        watching: true,
        watchingSince: '2026-01-01T00:00:00Z',
        checksStatus: 'pending',
        unresolvedComments: 0,
      };

      queryResults = [{
        uuid: 'pr-owner-repo-42',
        name: 'PR:owner/repo#42',
        content: JSON.stringify(existingPr),
        group_id: 'user:test',
        created_at: '2026-01-26T00:00:00Z',
      }];

      await repo.setWatching('user:test', 'owner/repo', 42, false);

      assert.strictEqual(writeCalls.length, 1);
      // Verify the content was updated
      const writtenContent = JSON.parse(writeCalls[0].params?.content as string);
      assert.strictEqual(writtenContent.watching, false);
    });
  });

  describe('deletePr()', () => {
    it('should delete PR and related entities', async () => {
      await repo.deletePr('user:test', 'owner/repo', 42);

      assert.strictEqual(writeCalls.length, 1);
      // Verify detach delete is used
      assert.ok(writeCalls[0].cypher.includes('DETACH DELETE'));
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

      // Set up mock to return PR on first call, empty for relations
      let callCount = 0;
      mockConnection.query = async <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> => {
        queryCalls.push({ cypher, params });
        callCount++;
        if (callCount === 1) {
          // PR query
          return [{
            uuid: 'pr-owner-repo-42',
            name: 'PR:owner/repo#42',
            content: JSON.stringify(prContent),
            group_id: 'user:test',
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

  describe('findIssuesByPr()', () => {
    it('should query with correct relationship pattern', async () => {
      queryResults = [];
      await repo.findIssuesByPr('user:test', 'owner/repo', 42);

      assert.strictEqual(queryCalls.length, 1);
      assert.ok(queryCalls[0].cypher.includes('CLOSES'));
      assert.strictEqual(queryCalls[0].params?.prName, 'PR:owner/repo#42');
    });
  });

  describe('findChecksByPr()', () => {
    it('should query with correct relationship pattern', async () => {
      queryResults = [];
      await repo.findChecksByPr('user:test', 'owner/repo', 42);

      assert.strictEqual(queryCalls.length, 1);
      assert.ok(queryCalls[0].cypher.includes('HAS_CHECK'));
      assert.strictEqual(queryCalls[0].params?.prName, 'PR:owner/repo#42');
    });
  });

  describe('findCommentsByPr()', () => {
    it('should query with correct relationship pattern', async () => {
      queryResults = [];
      await repo.findCommentsByPr('user:test', 'owner/repo', 42);

      assert.strictEqual(queryCalls.length, 1);
      assert.ok(queryCalls[0].cypher.includes('HAS_COMMENT'));
      assert.strictEqual(queryCalls[0].params?.prName, 'PR:owner/repo#42');
    });
  });
});
