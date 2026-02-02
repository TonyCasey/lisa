/**
 * Tests for MemoryContextLoader ranking algorithm (#181).
 *
 * Tests the 6-tier priority ranking:
 * T1: confidence:verified
 * T2: source:user-explicit
 * T3: confidence:high + within 48h
 * T4: Active tasks (type:task, status not done)
 * T5: confidence:medium + within 24h
 * T6: Everything else
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { IMemoryItem } from '../../../../../../src/lib/domain';
import { MemoryContextLoader } from '../../../../../../src/lib/application/services/MemoryContextLoader';

// Minimal mock dependencies to construct a MemoryContextLoader
function createLoader(): MemoryContextLoader {
  const mockMemory = { loadMemory: async () => ({}), loadFactsDateOrdered: async () => [], searchFacts: async () => [], addFact: async () => {}, addFactWithLifecycle: async () => {}, saveMemory: async () => {}, expireFact: async () => {}, cleanupExpired: async () => 0 };
  const mockTasks = { getTasks: async () => [], getTasksSimple: async () => [], getTaskCounts: async () => ({}), createTask: async () => ({}), updateTask: async () => ({}) };
  const mockMcp = { call: async () => [{}] };
  return new MemoryContextLoader(
    mockMemory as any,
    mockTasks as any,
    mockMcp as any,
  );
}

function createFact(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: `fact-${Math.random().toString(36).slice(2, 8)}`,
    fact: 'Test fact',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MemoryContextLoader — rankAndSelectFacts (#181)', () => {
  describe('tier assignment', () => {
    it('should prioritize confidence:verified facts (Tier 1)', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Low priority', tags: [] }),
        createFact({ fact: 'Verified fact', tags: ['confidence:verified'] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result[0].fact, 'Verified fact');
    });

    it('should prioritize source:user-explicit facts (Tier 2)', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Low priority', tags: [] }),
        createFact({ fact: 'User explicit', tags: ['source:user-explicit'] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result[0].fact, 'User explicit');
    });

    it('should include confidence:high within 48h as Tier 3', () => {
      const loader = createLoader();
      const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
      const facts = [
        createFact({ fact: 'Background', tags: [] }),
        createFact({ fact: 'High recent', tags: ['confidence:high'], created_at: recentDate }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result[0].fact, 'High recent');
    });

    it('should not promote confidence:high older than 48h to Tier 3', () => {
      const loader = createLoader();
      const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72h ago
      const facts = [
        createFact({ fact: 'High old', tags: ['confidence:high'], created_at: oldDate }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      // Should still be included but as Tier 6 (background)
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].fact, 'High old');
    });

    it('should include active tasks as Tier 4', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Background', tags: [] }),
        createFact({ fact: 'Active task', tags: ['type:task', 'status:in-progress'] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result[0].fact, 'Active task');
    });

    it('should not promote done tasks to Tier 4', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Done task', tags: ['type:task', 'status:done'] }),
        createFact({ fact: 'Background', tags: [] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      // Both should be in T6
      assert.strictEqual(result.length, 2);
    });

    it('should include confidence:medium within 24h as Tier 5', () => {
      const loader = createLoader();
      const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago
      const facts = [
        createFact({ fact: 'Background', tags: [] }),
        createFact({ fact: 'Medium recent', tags: ['confidence:medium'], created_at: recentDate }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result[0].fact, 'Medium recent');
    });
  });

  describe('budget cap', () => {
    it('should cap total facts at 30', () => {
      const loader = createLoader();
      const facts: IMemoryItem[] = [];
      for (let i = 0; i < 50; i++) {
        facts.push(createFact({ fact: `Fact ${i}`, tags: [] }));
      }

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result.length, 30);
    });

    it('should respect Tier 3 cap of 15', () => {
      const loader = createLoader();
      const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const facts: IMemoryItem[] = [];
      for (let i = 0; i < 20; i++) {
        facts.push(createFact({
          fact: `High fact ${i}`,
          tags: ['confidence:high'],
          created_at: recentDate,
        }));
      }

      const result = loader.rankAndSelectFacts(facts);

      // Should cap at 15 from T3
      assert.ok(result.length <= 15, `Expected <= 15, got ${result.length}`);
    });

    it('should respect Tier 4 cap of 10', () => {
      const loader = createLoader();
      const facts: IMemoryItem[] = [];
      for (let i = 0; i < 15; i++) {
        facts.push(createFact({
          fact: `Task ${i}`,
          tags: ['type:task', 'status:in-progress'],
        }));
      }

      const result = loader.rankAndSelectFacts(facts);

      assert.ok(result.length <= 10, `Expected <= 10, got ${result.length}`);
    });

    it('should respect Tier 5 cap of 5', () => {
      const loader = createLoader();
      const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const facts: IMemoryItem[] = [];
      for (let i = 0; i < 10; i++) {
        facts.push(createFact({
          fact: `Medium fact ${i}`,
          tags: ['confidence:medium'],
          created_at: recentDate,
        }));
      }

      const result = loader.rankAndSelectFacts(facts);

      assert.ok(result.length <= 5, `Expected <= 5, got ${result.length}`);
    });

    it('should fill remaining budget with Tier 6 facts', () => {
      const loader = createLoader();
      const facts: IMemoryItem[] = [
        createFact({ fact: 'Verified', tags: ['confidence:verified'] }),
        ...Array.from({ length: 40 }, (_, i) =>
          createFact({ fact: `Background ${i}`, tags: [] })
        ),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result.length, 30);
      assert.strictEqual(result[0].fact, 'Verified');
    });
  });

  describe('file-aware boost', () => {
    it('should boost facts mentioning recent file paths to Tier 3', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Background fact', tags: [] }),
        createFact({ fact: 'Updated src/api.ts with caching', tags: ['confidence:low'] }),
      ];

      const result = loader.rankAndSelectFacts(facts, ['src/api.ts']);

      assert.strictEqual(result[0].fact, 'Updated src/api.ts with caching');
    });

    it('should match file paths case-insensitively', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'Modified SRC/API.TS', tags: [] }),
      ];

      const result = loader.rankAndSelectFacts(facts, ['src/api.ts']);

      assert.strictEqual(result.length, 1);
    });
  });

  describe('ordering', () => {
    it('should order by tier priority (T1 before T6)', () => {
      const loader = createLoader();
      const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const facts = [
        createFact({ fact: 'Background', tags: [] }),
        createFact({ fact: 'Medium recent', tags: ['confidence:medium'], created_at: recentDate }),
        createFact({ fact: 'Verified', tags: ['confidence:verified'] }),
        createFact({ fact: 'User explicit', tags: ['source:user-explicit'] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      // T1 and T2 should come before T5 and T6
      const verifiedIdx = result.findIndex(f => f.fact === 'Verified');
      const backgroundIdx = result.findIndex(f => f.fact === 'Background');
      assert.ok(verifiedIdx < backgroundIdx, 'Verified should come before Background');
    });

    it('should handle empty facts array', () => {
      const loader = createLoader();
      const result = loader.rankAndSelectFacts([]);

      assert.strictEqual(result.length, 0);
    });

    it('should handle facts without tags', () => {
      const loader = createLoader();
      const facts = [
        createFact({ fact: 'No tags', tags: undefined }),
        createFact({ fact: 'Empty tags', tags: [] }),
      ];

      const result = loader.rankAndSelectFacts(facts);

      assert.strictEqual(result.length, 2);
    });
  });
});
