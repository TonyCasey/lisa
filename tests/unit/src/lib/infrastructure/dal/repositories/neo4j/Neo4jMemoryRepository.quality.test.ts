/**
 * Tests for Neo4jMemoryRepository quality methods.
 *
 * Tests findByMinConfidence() and findConflicts() using mocked Neo4j connection.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Neo4jMemoryRepository } from '../../../../../../../../src/lib/infrastructure/dal/repositories/neo4j/Neo4jMemoryRepository';
import type { Neo4jConnectionManager } from '../../../../../../../../src/lib/infrastructure/dal/connections/Neo4jConnectionManager';
import {
  CONFIDENCE_VALUES,
  resolveConfidenceTag,
} from '../../../../../../../../src/lib/domain/interfaces/types/IMemoryQuality';

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

describe('Neo4jMemoryRepository - quality', () => {
  let repo: Neo4jMemoryRepository;
  let mockConnection: Neo4jConnectionManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    repo = new Neo4jMemoryRepository(mockConnection);
  });

  describe('findByMinConfidence()', () => {
    it('should use parameterized query with confidence tags at or above requested level', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [
          {
            uuid: 'u1',
            name: 'n1',
            fact: 'f1',
            group_id: 'g1',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]
      );

      const result = await repo.findByMinConfidence(['g1'], 'medium');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      assert.strictEqual(queryFn.mock.calls.length, 1);

      const [cypher, params] = queryFn.mock.calls[0].arguments;
      // Cypher should use parameterized $groupIds and $acceptedTags
      assert.ok(cypher.includes('$groupIds'), 'should use parameterized $groupIds');
      assert.ok(cypher.includes('$acceptedTags'), 'should use parameterized $acceptedTags');

      // Params should contain the correct values
      assert.deepStrictEqual(params.groupIds, ['g1']);
      // 'medium' has score 0.5 — should include verified (1.0), high (0.8), medium (0.5)
      assert.ok(params.acceptedTags.includes('confidence:verified'));
      assert.ok(params.acceptedTags.includes('confidence:high'));
      assert.ok(params.acceptedTags.includes('confidence:medium'));
      assert.ok(!params.acceptedTags.includes('confidence:low'));
      assert.ok(!params.acceptedTags.includes('confidence:uncertain'));

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].uuid, 'u1');
      assert.strictEqual(result.source, 'neo4j');
    });

    it('should include all confidence levels when min is uncertain', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findByMinConfidence(['g1'], 'uncertain');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [, params] = queryFn.mock.calls[0].arguments;

      // 'uncertain' is the lowest — all 5 levels should be present in params
      for (const level of CONFIDENCE_VALUES) {
        assert.ok(
          params.acceptedTags.includes(resolveConfidenceTag(level)),
          `should include confidence:${level}`
        );
      }
    });

    it('should only include verified when min is verified', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findByMinConfidence(['g1'], 'verified');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [, params] = queryFn.mock.calls[0].arguments;

      assert.deepStrictEqual(params.acceptedTags, ['confidence:verified']);
    });

    it('should exclude expired facts by default', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findByMinConfidence(['g1'], 'medium');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('r.expired_at IS NULL'), 'should exclude expired facts');
    });

    it('should include expired facts when includeExpired is true', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findByMinConfidence(['g1'], 'medium', { includeExpired: true });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(
        !cypher.includes('r.expired_at IS NULL'),
        'should NOT contain expired_at IS NULL when includeExpired is true'
      );
    });

    it('should return empty result when no facts match', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      const result = await repo.findByMinConfidence(['g1'], 'high');

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.hasMore, false);
    });

    it('should apply limit and offset from options via params', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findByMinConfidence(['g1'], 'medium', { limit: 5, offset: 10 });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('SKIP $offset'), 'should use parameterized $offset');
      assert.ok(cypher.includes('LIMIT $limit'), 'should use parameterized $limit');
      assert.strictEqual(params.offset, 10);
      assert.strictEqual(params.limit, 5);
    });

    it('should propagate errors from connection.query', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Query failed'); }
      );

      await assert.rejects(
        () => repo.findByMinConfidence(['g1'], 'medium'),
        { message: 'Query failed' }
      );
    });
  });

  describe('findConflicts()', () => {
    it('should query for facts sharing type: tags with count > 1', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [
          {
            topicTag: 'type:decision',
            facts: [
              { uuid: 'u1', name: 'n1', fact: 'f1', created_at: '2026-01-01T00:00:00Z' },
              { uuid: 'u2', name: 'n2', fact: 'f2', created_at: '2026-01-02T00:00:00Z' },
            ],
          },
        ]
      );

      const result = await repo.findConflicts(['g1']);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].topic, 'type:decision');
      assert.strictEqual(result[0].facts.length, 2);
      assert.strictEqual(result[0].facts[0].uuid, 'u1');
      assert.strictEqual(result[0].facts[1].uuid, 'u2');
    });

    it('should use parameterized query with $groupIds', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findConflicts(['g1', 'g2']);

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('$groupIds'), 'should use parameterized $groupIds');
      assert.deepStrictEqual(params.groupIds, ['g1', 'g2']);
    });

    it('should filter by topic using parameterized $topic', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findConflicts(['g1'], 'type:decision');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher, params] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('$topic IN r.tags'), 'should use parameterized $topic');
      assert.strictEqual(params.topic, 'type:decision');
    });

    it('should only return groups with 2+ facts (WHERE SIZE(facts) > 1)', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findConflicts(['g1']);

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(
        cypher.includes('SIZE(facts) > 1'),
        'should contain SIZE(facts) > 1 in Cypher'
      );
    });

    it('should exclude expired facts by default', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findConflicts(['g1']);

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(
        cypher.includes('r.expired_at IS NULL'),
        'should exclude expired facts'
      );
    });

    it('should include expired facts when includeExpired is true', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      await repo.findConflicts(['g1'], undefined, { includeExpired: true });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(
        !cypher.includes('r.expired_at IS NULL'),
        'should NOT contain expired_at IS NULL when includeExpired is true'
      );
    });

    it('should return empty array when no conflicts', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => []
      );

      const result = await repo.findConflicts(['g1']);

      assert.strictEqual(result.length, 0);
    });

    it('should include detectedAt timestamp in each group', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => [
          {
            topicTag: 'type:convention',
            facts: [
              { uuid: 'u1', name: 'n1', fact: 'f1', created_at: '2026-01-01T00:00:00Z' },
              { uuid: 'u2', name: 'n2', fact: 'f2', created_at: '2026-01-02T00:00:00Z' },
            ],
          },
        ]
      );

      const result = await repo.findConflicts(['g1']);

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].detectedAt, 'should have a detectedAt field');
      // Verify it is a valid ISO string by attempting to parse it
      const parsed = new Date(result[0].detectedAt);
      assert.ok(!isNaN(parsed.getTime()), 'detectedAt should be a valid ISO date string');
    });

    it('should propagate errors from connection.query', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Connection failed'); }
      );

      await assert.rejects(
        () => repo.findConflicts(['g1']),
        { message: 'Connection failed' }
      );
    });
  });
});
