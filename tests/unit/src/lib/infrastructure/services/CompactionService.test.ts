/**
 * Tests for CompactionService.
 *
 * Tests fact grouping, summary generation, and compaction orchestration.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CompactionService } from '../../../../../../src/lib/infrastructure/services/CompactionService';
import type { IMemoryItem } from '../../../../../../src/lib/domain/interfaces/types/IMemoryResult';

/** Tracking arrays for mock calls. */
let addFactCalls: Array<{ groupId: string; fact: string; tags: readonly string[] }>;
let expireFactCalls: Array<{ groupId: string; uuid: string }>;
let loadFactsCalls: Array<{ groupIds: readonly string[]; limit: number; options?: { until?: Date } }>;

function createMockMemoryService(factsToReturn: IMemoryItem[] = []) {
  return {
    loadMemory: async () => ({ facts: [], nodes: [], tasks: [], timedOut: false, initReview: null }),
    loadFactsDateOrdered: async (groupIds: readonly string[], limit: number, options?: { since?: Date; until?: Date }) => {
      loadFactsCalls.push({ groupIds, limit, options: options ? { until: options.until } : undefined });
      return factsToReturn;
    },
    searchFacts: async () => [],
    saveMemory: async () => {},
    addFact: async (groupId: string, fact: string, tags: readonly string[] = []) => {
      addFactCalls.push({ groupId, fact, tags });
    },
    addFactWithLifecycle: async () => {},
    expireFact: async (groupId: string, uuid: string) => {
      expireFactCalls.push({ groupId, uuid });
    },
    cleanupExpired: async () => 0,
  };
}

describe('CompactionService', () => {
  beforeEach(() => {
    addFactCalls = [];
    expireFactCalls = [];
    loadFactsCalls = [];
  });

  describe('compact()', () => {
    it('should return empty result when no facts exist', async () => {
      const service = new CompactionService(createMockMemoryService([]));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
      });

      assert.strictEqual(result.groupsProcessed, 0);
      assert.strictEqual(result.factsArchived, 0);
      assert.strictEqual(result.summariesCreated, 0);
      assert.deepStrictEqual(result.summaries, []);
    });

    it('should skip groups smaller than minGroupSize', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'a', name: 'DECISION: Use Redis', fact: 'Use Redis for caching', created_at: '2025-12-01T00:00:00.000Z' },
        { uuid: 'b', name: 'MILESTONE: Released v1', fact: 'Released v1', created_at: '2025-12-02T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        minGroupSize: 3,
      });

      // Each category has only 1 fact, below threshold
      assert.strictEqual(result.groupsProcessed, 0);
      assert.strictEqual(result.factsArchived, 0);
    });

    it('should group facts by name prefix and generate summaries', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'a1', name: 'DECISION: Use Redis', fact: 'Use Redis for caching', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'a2', name: 'DECISION: Use TypeScript', fact: 'Use TypeScript', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'a3', name: 'DECISION: Use Neo4j', fact: 'Use Neo4j', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      assert.strictEqual(result.groupsProcessed, 1);
      assert.strictEqual(result.summariesCreated, 1);
      assert.strictEqual(result.factsArchived, 3);
      assert.strictEqual(result.summaries[0].topic, 'decision');
      assert.strictEqual(result.summaries[0].factCount, 3);
      assert.ok(result.summaries[0].summaryText.includes('[Compacted] Decision:'));
      assert.ok(result.summaries[0].summaryText.includes('3 items'));
    });

    it('should group facts by type: tag when no name prefix', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'b1', name: 'some fact', fact: 'fact one', tags: ['type:milestone'], created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'b2', name: 'another fact', fact: 'fact two', tags: ['type:milestone'], created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'b3', name: 'third fact', fact: 'fact three', tags: ['type:milestone'], created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      assert.strictEqual(result.groupsProcessed, 1);
      assert.strictEqual(result.summaries[0].topic, 'milestone');
    });

    it('should group untagged facts under "general"', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'c1', name: 'fact one', fact: 'just a fact', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'c2', name: 'fact two', fact: 'another fact', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'c3', name: 'fact three', fact: 'yet another', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      assert.strictEqual(result.summaries[0].topic, 'general');
    });

    it('should not expire or add facts in dry run mode', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'd1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'd2', name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'd3', name: 'DECISION: C', fact: 'C', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      assert.strictEqual(addFactCalls.length, 0);
      assert.strictEqual(expireFactCalls.length, 0);
    });

    it('should save summary and expire originals when not dry run', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'e1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'e2', name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'e3', name: 'DECISION: C', fact: 'C', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: false,
        minGroupSize: 3,
      });

      // Summary fact should be saved
      assert.strictEqual(addFactCalls.length, 1);
      assert.strictEqual(addFactCalls[0].groupId, 'group-1');
      assert.ok(addFactCalls[0].fact.includes('[Compacted]'));
      assert.ok(addFactCalls[0].tags.includes('type:compaction-summary'));
      assert.ok(addFactCalls[0].tags.includes('compacted:decision'));

      // All 3 originals should be expired
      assert.strictEqual(expireFactCalls.length, 3);
      assert.deepStrictEqual(
        expireFactCalls.map(c => c.uuid).sort(),
        ['e1', 'e2', 'e3']
      );

      assert.strictEqual(result.factsArchived, 3);
      assert.strictEqual(result.summariesCreated, 1);
    });

    it('should handle multiple groups', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'f1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'f2', name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'f3', name: 'DECISION: C', fact: 'C', created_at: '2025-12-01T00:00:00.000Z' },
        { uuid: 'f4', name: 'MILESTONE: X', fact: 'X', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'f5', name: 'MILESTONE: Y', fact: 'Y', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'f6', name: 'MILESTONE: Z', fact: 'Z', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      assert.strictEqual(result.groupsProcessed, 2);
      assert.strictEqual(result.summariesCreated, 2);
      assert.strictEqual(result.factsArchived, 6);

      const topics = result.summaries.map(s => s.topic).sort();
      assert.deepStrictEqual(topics, ['decision', 'milestone']);
    });

    it('should use default minGroupSize of 3', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'g1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'g2', name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        // No minGroupSize specified - should default to 3
      });

      assert.strictEqual(result.groupsProcessed, 0); // 2 < 3
    });

    it('should include date range in summary text', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'h1', name: 'DECISION: A', fact: 'Decision about A', created_at: '2025-10-15T10:00:00.000Z' },
        { uuid: 'h2', name: 'DECISION: B', fact: 'Decision about B', created_at: '2025-11-20T12:00:00.000Z' },
        { uuid: 'h3', name: 'DECISION: C', fact: 'Decision about C', created_at: '2025-12-25T14:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      const summaryText = result.summaries[0].summaryText;
      assert.ok(summaryText.includes('2025-10-15'));
      assert.ok(summaryText.includes('2025-12-25'));
    });

    it('should truncate long fact snippets', async () => {
      const longText = 'A'.repeat(100);
      const facts: IMemoryItem[] = [
        { uuid: 'i1', name: 'DECISION: X', fact: longText, created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'i2', name: 'DECISION: Y', fact: 'Short', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'i3', name: 'DECISION: Z', fact: 'Also short', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      const summaryText = result.summaries[0].summaryText;
      assert.ok(summaryText.includes('...'));
      // Should not contain the full 100 chars
      assert.ok(!summaryText.includes(longText));
    });

    it('should pass olderThan as until date to loadFactsDateOrdered', async () => {
      const olderThan = new Date('2025-12-15');
      const service = new CompactionService(createMockMemoryService([]));
      await service.compact('group-1', { olderThan });

      assert.strictEqual(loadFactsCalls.length, 1);
      assert.strictEqual(loadFactsCalls[0].groupIds[0], 'group-1');
      assert.strictEqual(loadFactsCalls[0].options?.until, olderThan);
    });

    it('should skip facts without uuid when archiving', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'j1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' }, // No uuid
        { uuid: 'j3', name: 'DECISION: C', fact: 'C', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: false,
        minGroupSize: 3,
      });

      // Only 2 facts have UUIDs
      assert.strictEqual(result.summaries[0].archivedUuids.length, 2);
      assert.strictEqual(expireFactCalls.length, 2);
    });

    it('should ignore type:compaction-summary tags for categorization', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'k1', name: 'fact one', fact: 'A', tags: ['type:compaction-summary'], created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'k2', name: 'fact two', fact: 'B', tags: ['type:compaction-summary'], created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'k3', name: 'fact three', fact: 'C', tags: ['type:compaction-summary'], created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.compact('group-1', {
        olderThan: new Date('2026-01-01'),
        dryRun: true,
        minGroupSize: 3,
      });

      // Should fall to 'general' since compaction-summary is excluded
      assert.strictEqual(result.summaries[0].topic, 'general');
    });
  });

  describe('preview()', () => {
    it('should be equivalent to compact with dryRun=true', async () => {
      const facts: IMemoryItem[] = [
        { uuid: 'p1', name: 'DECISION: A', fact: 'A', created_at: '2025-11-01T00:00:00.000Z' },
        { uuid: 'p2', name: 'DECISION: B', fact: 'B', created_at: '2025-11-15T00:00:00.000Z' },
        { uuid: 'p3', name: 'DECISION: C', fact: 'C', created_at: '2025-12-01T00:00:00.000Z' },
      ];

      const service = new CompactionService(createMockMemoryService(facts));
      const result = await service.preview('group-1', {
        olderThan: new Date('2026-01-01'),
        minGroupSize: 3,
      });

      assert.strictEqual(result.groupsProcessed, 1);
      assert.strictEqual(addFactCalls.length, 0);
      assert.strictEqual(expireFactCalls.length, 0);
    });
  });
});
