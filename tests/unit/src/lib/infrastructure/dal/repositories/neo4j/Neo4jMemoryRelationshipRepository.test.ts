/**
 * Tests for Neo4jMemoryRelationshipRepository.
 *
 * Tests create, find, and remove relationship operations using mocked Neo4j connection.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Neo4jMemoryRelationshipRepository } from '../../../../../../../../src/lib/infrastructure/dal/repositories/neo4j/Neo4jMemoryRelationshipRepository';
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

describe('Neo4jMemoryRelationshipRepository', () => {
  let repo: Neo4jMemoryRelationshipRepository;
  let mockConnection: Neo4jConnectionManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    repo = new Neo4jMemoryRelationshipRepository(mockConnection);
  });

  describe('createRelationship()', () => {
    it('should call write with correct Cypher and params', async () => {
      await repo.createRelationship('group-1', {
        sourceUuid: 'uuid-a',
        targetUuid: 'uuid-b',
        relationType: 'supersedes',
        metadata: 'Updated decision',
      });

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 1);

      const [cypher, params] = writeFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('MERGE (t1)-[rel:MEMORY_RELATION'));
      assert.ok(cypher.includes('type: $relationType'));
      assert.ok(cypher.includes('source_uuid: $sourceUuid'));
      assert.ok(cypher.includes('target_uuid: $targetUuid'));
      assert.ok(cypher.includes('SET rel.created_at = datetime()'));
      assert.ok(cypher.includes('rel.metadata = $metadata'));
      assert.ok(cypher.includes('rel.group_id = $groupId'));
      assert.strictEqual(params.sourceUuid, 'uuid-a');
      assert.strictEqual(params.targetUuid, 'uuid-b');
      assert.strictEqual(params.relationType, 'supersedes');
      assert.strictEqual(params.metadata, 'Updated decision');
      assert.strictEqual(params.groupId, 'group-1');
      assert.deepStrictEqual(params.groupIds, ['group-1']);
    });

    it('should pass null metadata when not provided', async () => {
      await repo.createRelationship('group-1', {
        sourceUuid: 'uuid-a',
        targetUuid: 'uuid-b',
        relationType: 'supports',
      });

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.strictEqual(params.metadata, null);
    });

    it('should propagate errors from connection.write', async () => {
      (mockConnection.write as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Connection failed'); }
      );

      await assert.rejects(
        () => repo.createRelationship('group-1', {
          sourceUuid: 'uuid-a',
          targetUuid: 'uuid-b',
          relationType: 'relates_to',
        }),
        { message: 'Connection failed' }
      );
    });
  });

  describe('findRelationships()', () => {
    it('should query both directions by default', async () => {
      await repo.findRelationships('group-1', 'uuid-a');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      assert.strictEqual(queryFn.mock.calls.length, 2);

      // First call: outgoing (source_uuid = uuid)
      const [outCypher, outParams] = queryFn.mock.calls[0].arguments;
      assert.ok(outCypher.includes('rel.source_uuid = $uuid'));
      assert.strictEqual(outParams.uuid, 'uuid-a');
      assert.strictEqual(outParams.groupId, 'group-1');

      // Second call: incoming (target_uuid = uuid)
      const [inCypher, inParams] = queryFn.mock.calls[1].arguments;
      assert.ok(inCypher.includes('rel.target_uuid = $uuid'));
      assert.strictEqual(inParams.uuid, 'uuid-a');
      assert.strictEqual(inParams.groupId, 'group-1');
    });

    it('should query only outgoing when direction is outgoing', async () => {
      await repo.findRelationships('group-1', 'uuid-a', { direction: 'outgoing' });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      assert.strictEqual(queryFn.mock.calls.length, 1);

      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('rel.source_uuid = $uuid'));
    });

    it('should query only incoming when direction is incoming', async () => {
      await repo.findRelationships('group-1', 'uuid-a', { direction: 'incoming' });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      assert.strictEqual(queryFn.mock.calls.length, 1);

      const [cypher] = queryFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('rel.target_uuid = $uuid'));
    });

    it('should filter by relationType when provided', async () => {
      await repo.findRelationships('group-1', 'uuid-a', { relationType: 'supersedes' });

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      // Both outgoing and incoming queries
      assert.strictEqual(queryFn.mock.calls.length, 2);

      const [outCypher, outParams] = queryFn.mock.calls[0].arguments;
      assert.ok(outCypher.includes('AND rel.type = $relationType'));
      assert.strictEqual(outParams.relationType, 'supersedes');
    });

    it('should not include relationType filter when not provided', async () => {
      await repo.findRelationships('group-1', 'uuid-a');

      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      const [outCypher, outParams] = queryFn.mock.calls[0].arguments;
      // Should NOT have the relationType filter clause
      assert.ok(!outCypher.includes('AND rel.type = $relationType'));
      assert.strictEqual(outParams.relationType, null);
    });

    it('should return combined outgoing and incoming results', async () => {
      const queryFn = mockConnection.query as ReturnType<typeof mock.fn>;
      let callCount = 0;
      queryFn.mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Outgoing
          return [{
            sourceUuid: 'uuid-a',
            targetUuid: 'uuid-b',
            relationType: 'supersedes',
            metadata: null,
            created_at: '2026-01-30T00:00:00Z',
          }];
        }
        // Incoming
        return [{
          sourceUuid: 'uuid-c',
          targetUuid: 'uuid-a',
          relationType: 'supports',
          metadata: 'note',
          created_at: '2026-01-29T00:00:00Z',
        }];
      });

      const results = await repo.findRelationships('group-1', 'uuid-a');
      assert.strictEqual(results.length, 2);

      assert.strictEqual(results[0].sourceUuid, 'uuid-a');
      assert.strictEqual(results[0].targetUuid, 'uuid-b');
      assert.strictEqual(results[0].relationType, 'supersedes');
      assert.strictEqual(results[0].metadata, undefined);
      assert.strictEqual(results[0].created_at, '2026-01-30T00:00:00Z');

      assert.strictEqual(results[1].sourceUuid, 'uuid-c');
      assert.strictEqual(results[1].targetUuid, 'uuid-a');
      assert.strictEqual(results[1].relationType, 'supports');
      assert.strictEqual(results[1].metadata, 'note');
    });

    it('should return empty array when no relationships found', async () => {
      const results = await repo.findRelationships('group-1', 'uuid-a');
      assert.strictEqual(results.length, 0);
    });

    it('should propagate errors from connection.query', async () => {
      (mockConnection.query as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Query failed'); }
      );

      await assert.rejects(
        () => repo.findRelationships('group-1', 'uuid-a'),
        { message: 'Query failed' }
      );
    });
  });

  describe('removeRelationship()', () => {
    it('should call write with correct Cypher and params', async () => {
      await repo.removeRelationship('group-1', 'uuid-a', 'uuid-b', 'supersedes');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 1);

      const [cypher, params] = writeFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)'));
      assert.ok(cypher.includes('rel.source_uuid = $sourceUuid'));
      assert.ok(cypher.includes('rel.target_uuid = $targetUuid'));
      assert.ok(cypher.includes('rel.type = $relationType'));
      assert.ok(cypher.includes('rel.group_id = $groupId'));
      assert.ok(cypher.includes('DELETE rel'));
      assert.strictEqual(params.sourceUuid, 'uuid-a');
      assert.strictEqual(params.targetUuid, 'uuid-b');
      assert.strictEqual(params.relationType, 'supersedes');
      assert.strictEqual(params.groupId, 'group-1');
    });

    it('should propagate errors from connection.write', async () => {
      (mockConnection.write as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Write failed'); }
      );

      await assert.rejects(
        () => repo.removeRelationship('group-1', 'uuid-a', 'uuid-b', 'supersedes'),
        { message: 'Write failed' }
      );
    });
  });
});
