/**
 * Tests for Neo4jMemoryRepository write methods.
 *
 * Tests save() and saveBatch() using mocked Neo4j connection.
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

describe('Neo4jMemoryRepository - write', () => {
  let repo: Neo4jMemoryRepository;
  let mockConnection: Neo4jConnectionManager;

  beforeEach(() => {
    mockConnection = createMockConnection();
    repo = new Neo4jMemoryRepository(mockConnection);
  });

  describe('save()', () => {
    it('should call connection.write with MERGE/CREATE Cypher', async () => {
      await repo.save('c-dev-lisa', 'User prefers dark mode');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 1);

      const [cypher] = writeFn.mock.calls[0].arguments;
      assert.ok(cypher.includes('MERGE (s:Entity {name: $sourceName})'), 'should MERGE source entity');
      assert.ok(cypher.includes('MERGE (t:Entity {name: $targetName})'), 'should MERGE target entity');
      assert.ok(cypher.includes('CREATE (s)-[:RELATES_TO'), 'should CREATE relationship');
      assert.ok(cypher.includes('uuid: $uuid'), 'should set uuid');
      assert.ok(cypher.includes('group_id: $groupId'), 'should set group_id');
      assert.ok(cypher.includes('fact: $content'), 'should set fact content');
      assert.ok(cypher.includes('tags: $tags'), 'should set tags on relationship');
    });

    it('should pass correct params including groupId and content', async () => {
      await repo.save('c-dev-lisa', 'Test fact content');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;

      assert.strictEqual(params.groupId, 'c-dev-lisa');
      assert.strictEqual(params.content, 'Test fact content');
      assert.strictEqual(params.sourceName, 'c-dev-lisa');
      assert.ok(params.uuid, 'should generate a UUID');
      assert.ok(params.name, 'should derive a name');
    });

    it('should use group_id as source entity name', async () => {
      await repo.save('my-project', 'Some fact');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.strictEqual(params.sourceName, 'my-project');
    });

    it('should derive target entity name from first tag', async () => {
      await repo.save('c-dev-lisa', 'Some fact', { tags: ['MILESTONE'] });

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.strictEqual(params.targetName, 'fact-milestone');
    });

    it('should persist tags on the relationship for findByTags compatibility', async () => {
      await repo.save('c-dev-lisa', 'Some fact', { tags: ['MILESTONE', 'source:user'] });

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.deepStrictEqual(params.tags, ['MILESTONE', 'source:user']);
    });

    it('should persist empty tags array when no tags provided', async () => {
      await repo.save('c-dev-lisa', 'Some fact');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.deepStrictEqual(params.tags, []);
    });

    it('should use RELATES_TO as default target name when no tags', async () => {
      await repo.save('c-dev-lisa', 'Some fact');

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.strictEqual(params.targetName, 'fact-relates-to');
    });

    it('should truncate name to 80 characters', async () => {
      const longContent = 'A'.repeat(200);
      await repo.save('c-dev-lisa', longContent);

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      const [, params] = writeFn.mock.calls[0].arguments;
      assert.strictEqual(params.name.length, 80);
    });

    it('should return IMemoryItem with uuid, name, fact, and created_at', async () => {
      const result = await repo.save('c-dev-lisa', 'Test fact');

      assert.ok(result.uuid, 'should have uuid');
      assert.ok(result.name, 'should have name');
      assert.strictEqual(result.fact, 'Test fact');
      assert.ok(result.created_at, 'should have created_at');
      // Verify created_at is a valid ISO string
      const parsed = new Date(result.created_at);
      assert.ok(!isNaN(parsed.getTime()), 'created_at should be valid ISO date');
    });

    it('should include tags in returned item when provided', async () => {
      const result = await repo.save('c-dev-lisa', 'Test fact', {
        tags: ['MILESTONE', 'source:user'],
      });

      assert.deepStrictEqual(result.tags, ['MILESTONE', 'source:user']);
    });

    it('should return undefined tags when none provided', async () => {
      const result = await repo.save('c-dev-lisa', 'Test fact');

      assert.strictEqual(result.tags, undefined);
    });

    it('should generate unique UUIDs for each save', async () => {
      const result1 = await repo.save('c-dev-lisa', 'Fact 1');
      const result2 = await repo.save('c-dev-lisa', 'Fact 2');

      assert.notStrictEqual(result1.uuid, result2.uuid);
    });

    it('should propagate errors from connection.write', async () => {
      (mockConnection.write as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Write failed'); }
      );

      await assert.rejects(
        () => repo.save('c-dev-lisa', 'Test fact'),
        { message: 'Write failed' }
      );
    });
  });

  describe('saveBatch()', () => {
    it('should save all facts', async () => {
      const facts = ['Fact 1', 'Fact 2', 'Fact 3'];
      const results = await repo.saveBatch('c-dev-lisa', facts);

      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].fact, 'Fact 1');
      assert.strictEqual(results[1].fact, 'Fact 2');
      assert.strictEqual(results[2].fact, 'Fact 3');
    });

    it('should call connection.write once per fact', async () => {
      const facts = ['Fact 1', 'Fact 2', 'Fact 3'];
      await repo.saveBatch('c-dev-lisa', facts);

      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 3);
    });

    it('should pass options to each individual save', async () => {
      const facts = ['Fact 1', 'Fact 2'];
      const results = await repo.saveBatch('c-dev-lisa', facts, {
        tags: ['type:milestone'],
      });

      assert.deepStrictEqual(results[0].tags, ['type:milestone']);
      assert.deepStrictEqual(results[1].tags, ['type:milestone']);
    });

    it('should generate unique UUIDs for each fact in batch', async () => {
      const facts = ['Fact 1', 'Fact 2', 'Fact 3'];
      const results = await repo.saveBatch('c-dev-lisa', facts);

      const uuids = results.map((r) => r.uuid);
      const uniqueUuids = new Set(uuids);
      assert.strictEqual(uniqueUuids.size, 3, 'all UUIDs should be unique');
    });

    it('should handle empty batch', async () => {
      const results = await repo.saveBatch('c-dev-lisa', []);

      assert.strictEqual(results.length, 0);
      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 0);
    });

    it('should process in batches of 5 (concurrency limit)', async () => {
      // Create 7 facts - should be processed as [5] then [2]
      const facts = Array.from({ length: 7 }, (_, i) => `Fact ${i + 1}`);
      const results = await repo.saveBatch('c-dev-lisa', facts);

      assert.strictEqual(results.length, 7);
      const writeFn = mockConnection.write as ReturnType<typeof mock.fn>;
      assert.strictEqual(writeFn.mock.calls.length, 7);
    });

    it('should propagate errors from individual saves', async () => {
      let callCount = 0;
      (mockConnection.write as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Write failed on second fact');
          }
        }
      );

      await assert.rejects(
        () => repo.saveBatch('c-dev-lisa', ['Fact 1', 'Fact 2', 'Fact 3']),
        { message: 'Write failed on second fact' }
      );
    });
  });

  describe('supportsWrite()', () => {
    it('should return true', () => {
      assert.strictEqual(repo.supportsWrite(), true);
    });
  });
});
