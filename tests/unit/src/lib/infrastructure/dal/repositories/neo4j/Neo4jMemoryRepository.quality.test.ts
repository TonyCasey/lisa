/**
 * Tests for Neo4jMemoryRepository quality methods.
 *
 * Tests findByMinConfidence() and findConflicts() using mocked Neo4j connection.
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

function createFactRecord(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'uuid-1',
    group_id: 'group-1',
    name: 'Test fact',
    fact: 'This is a test fact',
    created_at: '2026-01-31T12:00:00.000Z',
    tags: ['confidence:medium', 'source:user-explicit'],
    ...overrides,
  };
}

describe('Neo4jMemoryRepository - quality', () => {
  let repo: Neo4jMemoryRepository;
  let mockConnection: Neo4jConnectionManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    repo = new Neo4jMemoryRepository(mockConnection);
  });

  describe('findByMinConfidence()', () => {
    it('should return facts at or above the minimum confidence level', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:verified'], fact: 'Verified fact' }),
        createFactRecord({ uuid: 'uuid-2', tags: ['confidence:high'], fact: 'High confidence' }),
        createFactRecord({ uuid: 'uuid-3', tags: ['confidence:medium'], fact: 'Medium confidence' }),
        createFactRecord({ uuid: 'uuid-4', tags: ['confidence:low'], fact: 'Low confidence' }),
        createFactRecord({ uuid: 'uuid-5', tags: ['confidence:uncertain'], fact: 'Uncertain fact' }),
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'medium');

      // Should include verified (1.0), high (0.8), medium (0.5) but not low (0.3) or uncertain (0.1)
      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.source, 'neo4j');
    });

    it('should return empty result when no facts meet threshold', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:low'] }),
        createFactRecord({ uuid: 'uuid-2', tags: ['confidence:uncertain'] }),
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'high');
      assert.strictEqual(result.items.length, 0);
    });

    it('should exclude facts without confidence tags', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:high'] }),
        createFactRecord({ uuid: 'uuid-2', tags: ['lifecycle:session'] }), // No confidence tag
        createFactRecord({ uuid: 'uuid-3', tags: [] }), // No tags at all
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'medium');
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]?.uuid, 'uuid-1');
    });

    it('should respect the limit option', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:verified'] }),
        createFactRecord({ uuid: 'uuid-2', tags: ['confidence:high'] }),
        createFactRecord({ uuid: 'uuid-3', tags: ['confidence:medium'] }),
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'medium', { limit: 2 });
      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.hasMore, true);
    });

    it('should return all levels when minimum is uncertain', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:verified'] }),
        createFactRecord({ uuid: 'uuid-2', tags: ['confidence:uncertain'] }),
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'uncertain');
      assert.strictEqual(result.items.length, 2);
    });

    it('should only return verified when minimum is verified', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', tags: ['confidence:verified'] }),
        createFactRecord({ uuid: 'uuid-2', tags: ['confidence:high'] }),
      ]);

      const result = await repo.findByMinConfidence(['group-1'], 'verified');
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]?.uuid, 'uuid-1');
    });

    it('should handle empty results from Neo4j', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => []);

      const result = await repo.findByMinConfidence(['group-1'], 'low');
      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.hasMore, false);
    });

    it('should propagate errors from connection', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => {
        throw new Error('Connection failed');
      });

      await assert.rejects(
        () => repo.findByMinConfidence(['group-1'], 'medium'),
        { message: 'Connection failed' }
      );
    });
  });

  describe('findConflicts()', () => {
    it('should detect conflicting facts with same topic tag but different content', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({
          uuid: 'uuid-1',
          fact: 'Using PostgreSQL for storage',
          tags: ['database', 'confidence:high'],
        }),
        createFactRecord({
          uuid: 'uuid-2',
          fact: 'Using MongoDB for storage',
          tags: ['database', 'confidence:medium'],
        }),
      ]);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 1);
      assert.strictEqual(conflicts[0]?.topic, 'database');
      assert.strictEqual(conflicts[0]?.facts.length, 2);
      assert.ok(conflicts[0]?.detectedAt);
    });

    it('should not flag facts with same content as conflicts', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({
          uuid: 'uuid-1',
          fact: 'Using TypeScript',
          tags: ['language'],
        }),
        createFactRecord({
          uuid: 'uuid-2',
          fact: 'Using TypeScript',
          tags: ['language'],
        }),
      ]);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 0);
    });

    it('should exclude utility tags from topic grouping', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({
          uuid: 'uuid-1',
          fact: 'Fact A',
          tags: ['lifecycle:session', 'confidence:high', 'source:user-explicit', 'type:decision'],
        }),
        createFactRecord({
          uuid: 'uuid-2',
          fact: 'Fact B',
          tags: ['lifecycle:session', 'confidence:medium', 'source:session-capture', 'type:decision'],
        }),
      ]);

      // Should not group by utility tags - no non-utility tags means no topic groups
      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 0);
    });

    it('should filter conflicts by topic when provided', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({
          uuid: 'uuid-1',
          fact: 'PostgreSQL is the database',
          tags: ['database', 'backend'],
        }),
        createFactRecord({
          uuid: 'uuid-2',
          fact: 'MongoDB is the database',
          tags: ['database', 'backend'],
        }),
        createFactRecord({
          uuid: 'uuid-3',
          fact: 'React for frontend',
          tags: ['frontend'],
        }),
        createFactRecord({
          uuid: 'uuid-4',
          fact: 'Vue for frontend',
          tags: ['frontend'],
        }),
      ]);

      const conflicts = await repo.findConflicts(['group-1'], 'database');
      // Should only find database-related conflicts, not frontend
      assert.ok(conflicts.length >= 1);
      const topics = conflicts.map((c) => c.topic);
      assert.ok(topics.includes('database'), `Expected topics to include 'database', got ${JSON.stringify(topics)}`);
      // Should NOT include 'frontend' since it doesn't match topic filter
      assert.ok(!topics.includes('frontend'), `Should not include 'frontend' topic`);
    });

    it('should return empty array when no conflicts found', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({
          uuid: 'uuid-1',
          fact: 'Single fact about auth',
          tags: ['authentication'],
        }),
      ]);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 0);
    });

    it('should return empty array when Neo4j returns no facts', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => []);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 0);
    });

    it('should handle facts without tags', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', fact: 'No tags fact', tags: undefined }),
        createFactRecord({ uuid: 'uuid-2', fact: 'Empty tags fact', tags: [] }),
      ]);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 0);
    });

    it('should propagate errors from connection', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => {
        throw new Error('Connection failed');
      });

      await assert.rejects(
        () => repo.findConflicts(['group-1']),
        { message: 'Connection failed' }
      );
    });

    it('should detect multiple conflict groups', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      queryFn.mock.mockImplementation(async () => [
        createFactRecord({ uuid: 'uuid-1', fact: 'Using Postgres', tags: ['database'] }),
        createFactRecord({ uuid: 'uuid-2', fact: 'Using MySQL', tags: ['database'] }),
        createFactRecord({ uuid: 'uuid-3', fact: 'Using React', tags: ['framework'] }),
        createFactRecord({ uuid: 'uuid-4', fact: 'Using Vue', tags: ['framework'] }),
      ]);

      const conflicts = await repo.findConflicts(['group-1']);
      assert.strictEqual(conflicts.length, 2);

      const topics = conflicts.map((c) => c.topic).sort();
      assert.deepStrictEqual(topics, ['database', 'framework']);
    });
  });
});
