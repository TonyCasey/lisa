/**
 * Tests for Neo4jMemoryRepository expiration methods.
 *
 * Tests expire() and expireByFilter() using mocked Neo4j connection.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Neo4jMemoryRepository } from '../../../../../../../../src/lib/infrastructure/dal/repositories/neo4j/Neo4jMemoryRepository';
import type { Neo4jConnectionManager } from '../../../../../../../../src/lib/infrastructure/dal/connections/Neo4jConnectionManager';

function createMockConnection(): Neo4jConnectionManager {
  return {
    query: mock.fn(async () => []),
    write: mock.fn(async () => undefined),
    connect: mock.fn(async () => undefined),
    disconnect: mock.fn(async () => undefined),
    isConnected: mock.fn(async () => true),
    getConfig: mock.fn(() => ({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'test',
    })),
    execute: mock.fn(async () => []),
    getDriver: mock.fn(() => null),
  } as unknown as Neo4jConnectionManager;
}

describe('Neo4jMemoryRepository - expire', () => {
  let repo: Neo4jMemoryRepository;
  let mockConnection: Neo4jConnectionManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    repo = new Neo4jMemoryRepository(mockConnection);
  });

  describe('expire()', () => {
    it('should call write with correct Cypher and params', async () => {
      await repo.expire('group-1', 'uuid-abc');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 1);

      const [cypher, params] = writeFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('r.group_id = $groupId'));
      assert.ok(cypher.includes('r.uuid = $uuid'));
      assert.ok(cypher.includes('r.expired_at IS NULL'));
      assert.ok(cypher.includes('SET r.expired_at = datetime()'));
      assert.deepStrictEqual(params, { groupId: 'group-1', uuid: 'uuid-abc' });
    });

    it('should propagate errors from connection.write', async () => {
      (mockConnection.write as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Connection failed'); }
      );

      await assert.rejects(
        () => repo.expire('group-1', 'uuid-abc'),
        { message: 'Connection failed' }
      );
    });
  });

  describe('expireByFilter()', () => {
    it('should return 0 when no facts match', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 0 }]
      );

      const result = await repo.expireByFilter('group-1', {});
      assert.strictEqual(result, 0);

      // Should not call write when count is 0
      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 0);
    });

    it('should count and then expire matching facts', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 5 }]
      );

      const result = await repo.expireByFilter('group-1', {});
      assert.strictEqual(result, 5);

      // Should call query for count, then write for expiration
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(queryFn.mock.calls.length, 1);
      assert.strictEqual(writeFn.mock.calls.length, 1);
    });

    it('should filter by lifecycle tag', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 3 }]
      );

      await repo.expireByFilter('group-1', { lifecycle: 'session' });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('$lifecycleTag IN r.tags'));
      assert.strictEqual(params.lifecycleTag, 'lifecycle:session');
    });

    it('should filter by olderThan date', async () => {
      const cutoff = new Date('2026-01-30T00:00:00.000Z');
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 2 }]
      );

      await repo.expireByFilter('group-1', { olderThan: cutoff });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('r.created_at <= datetime($olderThan)'));
      assert.strictEqual(params.olderThan, '2026-01-30T00:00:00.000Z');
    });

    it('should filter by tags', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 1 }]
      );

      await repo.expireByFilter('group-1', { tags: ['type:prompt', 'source:user'] });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('ANY(tag IN $filterTags WHERE tag IN r.tags)'));
      assert.deepStrictEqual(params.filterTags, ['type:prompt', 'source:user']);
    });

    it('should combine all filter criteria', async () => {
      const cutoff = new Date('2026-01-30T00:00:00.000Z');
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 4 }]
      );

      await repo.expireByFilter('group-1', {
        lifecycle: 'ephemeral',
        olderThan: cutoff,
        tags: ['type:prompt'],
      });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;

      // All clauses present
      assert.ok(cypher.includes('r.group_id = $groupId'));
      assert.ok(cypher.includes('r.expired_at IS NULL'));
      assert.ok(cypher.includes('$lifecycleTag IN r.tags'));
      assert.ok(cypher.includes('r.created_at <= datetime($olderThan)'));
      assert.ok(cypher.includes('ANY(tag IN $filterTags WHERE tag IN r.tags)'));

      assert.strictEqual(params.groupId, 'group-1');
      assert.strictEqual(params.lifecycleTag, 'lifecycle:ephemeral');
      assert.strictEqual(params.olderThan, '2026-01-30T00:00:00.000Z');
      assert.deepStrictEqual(params.filterTags, ['type:prompt']);
    });

    it('should use same WHERE clause for count and expire queries', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [{ count: 2 }]
      );

      await repo.expireByFilter('group-1', { lifecycle: 'session' });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;

      const [countCypher] = queryFn.mock.calls[0].arguments;
      const [expireCypher] = writeFn.mock.calls[0].arguments;

      // Both should contain the same WHERE clause structure
      assert.ok(countCypher.includes('r.group_id = $groupId'));
      assert.ok(expireCypher.includes('r.group_id = $groupId'));
      assert.ok(countCypher.includes('$lifecycleTag IN r.tags'));
      assert.ok(expireCypher.includes('$lifecycleTag IN r.tags'));

      // Count query should have COUNT, expire should have SET
      assert.ok(countCypher.includes('count(r) AS count'));
      assert.ok(expireCypher.includes('SET r.expired_at = datetime()'));
    });

    it('should propagate errors from connection.query', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Query failed'); }
      );

      await assert.rejects(
        () => repo.expireByFilter('group-1', {}),
        { message: 'Query failed' }
      );
    });

    it('should handle empty query result gracefully', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      const result = await repo.expireByFilter('group-1', {});
      assert.strictEqual(result, 0);
    });
  });
});
