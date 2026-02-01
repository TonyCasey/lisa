/**
 * Tests for ConsolidationService.
 *
 * Tests fact consolidation actions: merge, archive-duplicates, keep-all.
 * Also tests validation and relationship creation.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createConsolidationService } from '../../../../../../src/lib/infrastructure/services/ConsolidationService';
import type { IConsolidationService } from '../../../../../../src/lib/domain/interfaces/IConsolidationService';
import type { IMemoryWriter, IMemoryReader, IMemoryRelationshipWriter } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { IMemoryItem, IMemoryResult } from '../../../../../../src/lib/domain/interfaces/types';
import type { IMemoryRelationship, MemoryRelationType } from '../../../../../../src/lib/domain/interfaces/types/IMemoryRelationship';

interface MockCall { method: string; args: unknown[] }

function createMockWriter(): IMemoryWriter & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  return {
    calls,
    async saveMemory(groupId: string, facts: readonly string[]): Promise<void> {
      calls.push({ method: 'saveMemory', args: [groupId, facts] });
    },
    async addFact(groupId: string, fact: string, tags?: readonly string[]): Promise<void> {
      calls.push({ method: 'addFact', args: [groupId, fact, tags] });
    },
    async addFactWithLifecycle(groupId: string, fact: string, options: unknown): Promise<void> {
      calls.push({ method: 'addFactWithLifecycle', args: [groupId, fact, options] });
    },
    async expireFact(groupId: string, uuid: string): Promise<void> {
      calls.push({ method: 'expireFact', args: [groupId, uuid] });
    },
    async cleanupExpired(groupId: string): Promise<number> {
      calls.push({ method: 'cleanupExpired', args: [groupId] });
      return 0;
    },
  };
}

function createMockReader(facts: IMemoryItem[] = []): IMemoryReader & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  return {
    calls,
    async loadMemory(groupIds: readonly string[]): Promise<IMemoryResult> {
      calls.push({ method: 'loadMemory', args: [groupIds] });
      return { facts: [], tasks: [] };
    },
    async loadFactsDateOrdered(groupIds: readonly string[], limit?: number): Promise<IMemoryItem[]> {
      calls.push({ method: 'loadFactsDateOrdered', args: [groupIds, limit] });
      return facts.slice(0, limit ?? facts.length);
    },
    async searchFacts(groupIds: readonly string[], query: string, limit?: number): Promise<IMemoryItem[]> {
      calls.push({ method: 'searchFacts', args: [groupIds, query, limit] });
      return [];
    },
  };
}

function createMockRelationshipWriter(): IMemoryRelationshipWriter & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  return {
    calls,
    async linkFacts(
      groupId: string,
      sourceUuid: string,
      targetUuid: string,
      relationType: MemoryRelationType,
      metadata?: string
    ): Promise<void> {
      calls.push({ method: 'linkFacts', args: [groupId, sourceUuid, targetUuid, relationType, metadata] });
    },
    async unlinkFacts(
      groupId: string,
      sourceUuid: string,
      targetUuid: string,
      relationType: MemoryRelationType
    ): Promise<void> {
      calls.push({ method: 'unlinkFacts', args: [groupId, sourceUuid, targetUuid, relationType] });
    },
    async getRelatedFacts(
      groupId: string,
      uuid: string,
      relationType?: MemoryRelationType
    ): Promise<IMemoryRelationship[]> {
      calls.push({ method: 'getRelatedFacts', args: [groupId, uuid, relationType] });
      return [];
    },
  };
}

function makeItem(uuid: string, fact: string, created_at?: string): IMemoryItem {
  return {
    uuid,
    name: fact.slice(0, 40),
    fact,
    created_at: created_at ?? '2026-01-15T00:00:00Z',
  };
}

describe('ConsolidationService', () => {
  let service: IConsolidationService;
  let mockWriter: ReturnType<typeof createMockWriter>;
  let mockReader: ReturnType<typeof createMockReader>;
  let mockRelWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(() => {
    mockWriter = createMockWriter();
    mockReader = createMockReader([
      makeItem('new-uuid', 'Merged content', '2026-01-20T00:00:00Z'),
      makeItem('uuid-a', 'Fact A', '2026-01-15T00:00:00Z'),
      makeItem('uuid-b', 'Fact B', '2026-01-10T00:00:00Z'),
    ]);
    mockRelWriter = createMockRelationshipWriter();
    service = createConsolidationService(mockWriter, mockReader, mockRelWriter);
  });

  describe('Validation', () => {
    it('should reject fewer than 2 UUIDs', async () => {
      await assert.rejects(
        () => service.consolidate('group1', ['uuid-a'], 'merge'),
        (err: Error) => {
          assert.ok(err.message.includes('at least 2'));
          return true;
        }
      );
    });

    it('should reject empty UUID list', async () => {
      await assert.rejects(
        () => service.consolidate('group1', [], 'merge'),
        (err: Error) => {
          assert.ok(err.message.includes('at least 2'));
          return true;
        }
      );
    });

    it('should reject retainUuid not in provided UUIDs', async () => {
      await assert.rejects(
        () => service.consolidate('group1', ['uuid-a', 'uuid-b'], 'archive-duplicates', {
          retainUuid: 'uuid-c',
        }),
        (err: Error) => {
          assert.ok(err.message.includes('not in the provided'));
          return true;
        }
      );
    });
  });

  describe('keep-all action', () => {
    it('should return empty result with no mutations', async () => {
      const result = await service.consolidate('group1', ['uuid-a', 'uuid-b'], 'keep-all');

      assert.strictEqual(result.action, 'keep-all');
      assert.strictEqual(result.retainedUuid, 'uuid-a');
      assert.strictEqual(result.archivedUuids.length, 0);
      assert.strictEqual(result.relationshipsCreated, 0);

      // No writer calls
      assert.strictEqual(mockWriter.calls.length, 0);
      assert.strictEqual(mockRelWriter.calls.length, 0);
    });
  });

  describe('merge action', () => {
    it('should create new fact and expire originals', async () => {
      const result = await service.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'merge',
        { mergedText: 'Merged content of A and B' }
      );

      assert.strictEqual(result.action, 'merge');
      assert.strictEqual(result.archivedUuids.length, 2);
      assert.ok(result.archivedUuids.includes('uuid-a'));
      assert.ok(result.archivedUuids.includes('uuid-b'));

      // Should have called addFact for the merged text
      const addCalls = mockWriter.calls.filter((c) => c.method === 'addFact');
      assert.strictEqual(addCalls.length, 1);
      assert.strictEqual(addCalls[0].args[1], 'Merged content of A and B');

      // Should have expired both originals
      const expireCalls = mockWriter.calls.filter((c) => c.method === 'expireFact');
      assert.strictEqual(expireCalls.length, 2);
    });

    it('should create supersedes relationships when writer available', async () => {
      const result = await service.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'merge',
        { mergedText: 'Merged content' }
      );

      assert.strictEqual(result.relationshipsCreated, 2);

      const linkCalls = mockRelWriter.calls.filter((c) => c.method === 'linkFacts');
      assert.strictEqual(linkCalls.length, 2);
      // Each should be 'supersedes'
      assert.strictEqual(linkCalls[0].args[3], 'supersedes');
      assert.strictEqual(linkCalls[1].args[3], 'supersedes');
    });

    it('should require mergedText for merge action', async () => {
      await assert.rejects(
        () => service.consolidate('group1', ['uuid-a', 'uuid-b'], 'merge'),
        (err: Error) => {
          assert.ok(err.message.includes('mergedText'));
          return true;
        }
      );
    });
  });

  describe('archive-duplicates action', () => {
    it('should keep specified retainUuid and expire others', async () => {
      const result = await service.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'archive-duplicates',
        { retainUuid: 'uuid-a' }
      );

      assert.strictEqual(result.action, 'archive-duplicates');
      assert.strictEqual(result.retainedUuid, 'uuid-a');
      assert.strictEqual(result.archivedUuids.length, 1);
      assert.ok(result.archivedUuids.includes('uuid-b'));

      // Should only expire uuid-b
      const expireCalls = mockWriter.calls.filter((c) => c.method === 'expireFact');
      assert.strictEqual(expireCalls.length, 1);
      assert.deepStrictEqual(expireCalls[0].args, ['group1', 'uuid-b']);
    });

    it('should default to newest fact when no retainUuid specified', async () => {
      // Mock reader returns facts ordered by date desc
      // 'new-uuid' is newest
      const readerWithOrder = createMockReader([
        makeItem('uuid-a', 'Fact A', '2026-01-20T00:00:00Z'),
        makeItem('uuid-b', 'Fact B', '2026-01-10T00:00:00Z'),
      ]);
      const svc = createConsolidationService(mockWriter, readerWithOrder, mockRelWriter);

      const result = await svc.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'archive-duplicates'
      );

      assert.strictEqual(result.retainedUuid, 'uuid-a');
      assert.ok(result.archivedUuids.includes('uuid-b'));
    });

    it('should create supersedes relationships', async () => {
      const result = await service.consolidate(
        'group1',
        ['uuid-a', 'uuid-b', 'uuid-c'],
        'archive-duplicates',
        { retainUuid: 'uuid-a' }
      );

      // uuid-b and uuid-c are archived
      assert.strictEqual(result.relationshipsCreated, 2);

      const linkCalls = mockRelWriter.calls.filter((c) => c.method === 'linkFacts');
      assert.strictEqual(linkCalls.length, 2);
      // All supersedes from uuid-a to archived
      for (const call of linkCalls) {
        assert.strictEqual(call.args[1], 'uuid-a'); // source = retained
        assert.strictEqual(call.args[3], 'supersedes');
      }
    });
  });

  describe('Without relationship writer', () => {
    it('should work gracefully without relationships', async () => {
      const svc = createConsolidationService(mockWriter, mockReader); // No rel writer

      const result = await svc.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'archive-duplicates',
        { retainUuid: 'uuid-a' }
      );

      assert.strictEqual(result.action, 'archive-duplicates');
      assert.strictEqual(result.relationshipsCreated, 0);
      assert.strictEqual(result.archivedUuids.length, 1);
    });

    it('should merge without relationships', async () => {
      const svc = createConsolidationService(mockWriter, mockReader); // No rel writer

      const result = await svc.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'merge',
        { mergedText: 'Combined fact' }
      );

      assert.strictEqual(result.action, 'merge');
      assert.strictEqual(result.relationshipsCreated, 0);
      assert.strictEqual(result.archivedUuids.length, 2);
    });
  });

  describe('Relationship writer errors', () => {
    it('should continue gracefully if linkFacts throws', async () => {
      const failingRelWriter: IMemoryRelationshipWriter = {
        async linkFacts(): Promise<void> {
          throw new Error('Connection failed');
        },
        async unlinkFacts(): Promise<void> {
          // no-op
        },
        async getRelatedFacts(): Promise<IMemoryRelationship[]> {
          return [];
        },
      };

      const svc = createConsolidationService(mockWriter, mockReader, failingRelWriter);

      const result = await svc.consolidate(
        'group1',
        ['uuid-a', 'uuid-b'],
        'archive-duplicates',
        { retainUuid: 'uuid-a' }
      );

      // Should still succeed, just no relationships
      assert.strictEqual(result.action, 'archive-duplicates');
      assert.strictEqual(result.relationshipsCreated, 0);
      assert.strictEqual(result.archivedUuids.length, 1);
    });
  });
});
