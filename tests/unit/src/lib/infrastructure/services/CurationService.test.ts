/**
 * Tests for CurationService.
 *
 * Tests curation mark application, quality score computation,
 * and fact ranking by quality.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createCurationService, computeRecencyBonus } from '../../../../../../src/lib/infrastructure/services/CurationService';
import {
  isValidCurationMark,
  parseCurationTag,
  resolveCurationTag,
} from '../../../../../../src/lib/domain/interfaces/ICurationService';
import type { ICurationService } from '../../../../../../src/lib/domain/interfaces/ICurationService';
import type { IMemoryWriter } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { IMemoryItem } from '../../../../../../src/lib/domain/interfaces/types';

/**
 * Create a mock IMemoryWriter that records calls.
 */
function createMockWriter(): IMemoryWriter & { calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
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

function makeItem(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: overrides.uuid ?? 'test-uuid',
    name: overrides.name ?? 'test fact',
    fact: overrides.fact ?? 'Test fact content',
    created_at: overrides.created_at ?? new Date().toISOString(),
    tags: overrides.tags ?? [],
    ...overrides,
  };
}

describe('CurationService', () => {
  let service: ICurationService;
  let mockWriter: ReturnType<typeof createMockWriter>;

  beforeEach(() => {
    mockWriter = createMockWriter();
    service = createCurationService(mockWriter);
  });

  describe('markFact()', () => {
    it('should add curation tag for draft mark', async () => {
      await service.markFact('group1', 'uuid1', 'draft');

      const addCalls = mockWriter.calls.filter((c) => c.method === 'addFact');
      assert.strictEqual(addCalls.length, 1);
      assert.deepStrictEqual(addCalls[0].args[2], ['curated:draft']);
    });

    it('should add curation tag for needs-review mark', async () => {
      await service.markFact('group1', 'uuid1', 'needs-review');

      const addCalls = mockWriter.calls.filter((c) => c.method === 'addFact');
      assert.strictEqual(addCalls.length, 1);
      assert.deepStrictEqual(addCalls[0].args[2], ['curated:needs-review']);
    });

    it('should expire fact when marking as deprecated', async () => {
      await service.markFact('group1', 'uuid1', 'deprecated');

      const expireCalls = mockWriter.calls.filter((c) => c.method === 'expireFact');
      assert.strictEqual(expireCalls.length, 1);
      assert.deepStrictEqual(expireCalls[0].args, ['group1', 'uuid1']);
    });

    it('should promote confidence to verified when marking as authoritative', async () => {
      await service.markFact('group1', 'uuid1', 'authoritative');

      const addCalls = mockWriter.calls.filter((c) => c.method === 'addFact');
      // One for curation tag, one for confidence promotion
      assert.strictEqual(addCalls.length, 2);
      assert.deepStrictEqual(addCalls[0].args[2], ['curated:authoritative']);
      assert.deepStrictEqual(addCalls[1].args[2], ['confidence:verified']);
    });

    it('should not expire or promote for draft mark', async () => {
      await service.markFact('group1', 'uuid1', 'draft');

      const expireCalls = mockWriter.calls.filter((c) => c.method === 'expireFact');
      const addCalls = mockWriter.calls.filter((c) => c.method === 'addFact');
      assert.strictEqual(expireCalls.length, 0);
      assert.strictEqual(addCalls.length, 1); // Only the curation tag
    });
  });

  describe('computeQualityScore()', () => {
    it('should return high score for verified user-explicit recent fact', () => {
      const item = makeItem({
        tags: ['confidence:verified', 'source:user-explicit'],
        created_at: new Date().toISOString(),
      });
      const score = service.computeQualityScore(item);
      // verified=1.0, user-explicit=1.0, recent=1.0 → 1.0
      assert.strictEqual(score, 1.0);
    });

    it('should return low score for uncertain auto-inferred old fact', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);
      const item = makeItem({
        tags: ['confidence:uncertain', 'source:auto-inferred'],
        created_at: oldDate.toISOString(),
      });
      const score = service.computeQualityScore(item);
      // uncertain=0.1, auto-inferred=0.3, old=0.5 → 0.015
      assert.ok(score < 0.05);
      assert.ok(score >= 0);
    });

    it('should use medium confidence when no confidence tag present', () => {
      const item = makeItem({
        tags: ['source:user-explicit'],
        created_at: new Date().toISOString(),
      });
      const score = service.computeQualityScore(item);
      // medium=0.5, user-explicit=1.0, recent=1.0 → 0.5
      assert.strictEqual(score, 0.5);
    });

    it('should use default source weight when no source tag present', () => {
      const item = makeItem({
        tags: ['confidence:high'],
        created_at: new Date().toISOString(),
      });
      const score = service.computeQualityScore(item);
      // high=0.8, default=0.5, recent=1.0 → 0.4
      assert.strictEqual(score, 0.4);
    });

    it('should handle empty tags array', () => {
      const item = makeItem({
        tags: [],
        created_at: new Date().toISOString(),
      });
      const score = service.computeQualityScore(item);
      // medium=0.5, default=0.5, recent=1.0 → 0.25
      assert.strictEqual(score, 0.25);
    });

    it('should handle missing tags', () => {
      const item = makeItem({
        created_at: new Date().toISOString(),
      });
      // Remove tags explicitly
      delete (item as Record<string, unknown>).tags;
      const score = service.computeQualityScore(item);
      assert.ok(score >= 0);
      assert.ok(score <= 1);
    });

    it('should cap score at 1.0', () => {
      const item = makeItem({
        tags: ['confidence:verified', 'source:user-explicit'],
        created_at: new Date().toISOString(),
      });
      const score = service.computeQualityScore(item);
      assert.ok(score <= 1.0);
    });

    it('should cap score at 0.0 minimum', () => {
      const score = service.computeQualityScore(makeItem());
      assert.ok(score >= 0.0);
    });

    it('should compute different scores for different source types', () => {
      const baseOpts = {
        tags: ['confidence:high'],
        created_at: new Date().toISOString(),
      };

      const userExplicit = service.computeQualityScore(
        makeItem({ ...baseOpts, tags: ['confidence:high', 'source:user-explicit'] })
      );
      const autoInferred = service.computeQualityScore(
        makeItem({ ...baseOpts, tags: ['confidence:high', 'source:auto-inferred'] })
      );

      assert.ok(userExplicit > autoInferred);
    });
  });

  describe('rankByQuality()', () => {
    it('should sort items by quality score descending', () => {
      const items = [
        makeItem({
          uuid: 'low',
          tags: ['confidence:low', 'source:auto-inferred'],
          created_at: new Date().toISOString(),
        }),
        makeItem({
          uuid: 'high',
          tags: ['confidence:verified', 'source:user-explicit'],
          created_at: new Date().toISOString(),
        }),
        makeItem({
          uuid: 'medium',
          tags: ['confidence:medium', 'source:session-capture'],
          created_at: new Date().toISOString(),
        }),
      ];

      const ranked = service.rankByQuality(items);
      assert.strictEqual(ranked.length, 3);
      assert.strictEqual(ranked[0].uuid, 'high');
      assert.strictEqual(ranked[2].uuid, 'low');
    });

    it('should return new array (immutable)', () => {
      const items = [
        makeItem({ uuid: 'a' }),
        makeItem({ uuid: 'b' }),
      ];
      const ranked = service.rankByQuality(items);
      assert.notStrictEqual(ranked, items);
    });

    it('should handle empty array', () => {
      const ranked = service.rankByQuality([]);
      assert.strictEqual(ranked.length, 0);
    });

    it('should handle single item', () => {
      const items = [makeItem({ uuid: 'only' })];
      const ranked = service.rankByQuality(items);
      assert.strictEqual(ranked.length, 1);
      assert.strictEqual(ranked[0].uuid, 'only');
    });
  });
});

describe('computeRecencyBonus()', () => {
  const now = new Date('2026-02-01T00:00:00Z');

  it('should return 1.0 for facts less than 7 days old', () => {
    const recent = new Date('2026-01-28T00:00:00Z'); // 4 days ago
    assert.strictEqual(computeRecencyBonus(recent.toISOString(), now), 1.0);
  });

  it('should return 1.0 for facts exactly 7 days old', () => {
    const sevenDays = new Date('2026-01-25T00:00:00Z'); // 7 days ago
    assert.strictEqual(computeRecencyBonus(sevenDays.toISOString(), now), 1.0);
  });

  it('should return 0.5 for facts 90+ days old', () => {
    const old = new Date('2025-10-01T00:00:00Z'); // ~123 days ago
    assert.strictEqual(computeRecencyBonus(old.toISOString(), now), 0.5);
  });

  it('should return value between 0.5 and 1.0 for facts between 7 and 90 days', () => {
    const middle = new Date('2026-01-01T00:00:00Z'); // 31 days ago
    const bonus = computeRecencyBonus(middle.toISOString(), now);
    assert.ok(bonus > 0.5, `Expected > 0.5, got ${bonus}`);
    assert.ok(bonus < 1.0, `Expected < 1.0, got ${bonus}`);
  });

  it('should return 0.5 for undefined created_at', () => {
    assert.strictEqual(computeRecencyBonus(undefined, now), 0.5);
  });

  it('should decay linearly', () => {
    // At midpoint (~48.5 days from epoch start at 7 days), bonus should be ~0.75
    const midpoint = new Date(now.getTime() - (7 + 83 / 2) * 24 * 60 * 60 * 1000);
    const bonus = computeRecencyBonus(midpoint.toISOString(), now);
    assert.ok(bonus > 0.7, `Expected > 0.7, got ${bonus}`);
    assert.ok(bonus < 0.8, `Expected < 0.8, got ${bonus}`);
  });
});

describe('Curation helpers', () => {
  describe('isValidCurationMark()', () => {
    it('should return true for valid marks', () => {
      assert.ok(isValidCurationMark('authoritative'));
      assert.ok(isValidCurationMark('draft'));
      assert.ok(isValidCurationMark('deprecated'));
      assert.ok(isValidCurationMark('needs-review'));
    });

    it('should return false for invalid marks', () => {
      assert.ok(!isValidCurationMark('invalid'));
      assert.ok(!isValidCurationMark(''));
      assert.ok(!isValidCurationMark('AUTHORITATIVE'));
    });
  });

  describe('resolveCurationTag()', () => {
    it('should return prefixed tag', () => {
      assert.strictEqual(resolveCurationTag('authoritative'), 'curated:authoritative');
      assert.strictEqual(resolveCurationTag('deprecated'), 'curated:deprecated');
    });
  });

  describe('parseCurationTag()', () => {
    it('should extract mark from tag array', () => {
      const tags = ['type:decision', 'curated:authoritative', 'confidence:high'];
      assert.strictEqual(parseCurationTag(tags), 'authoritative');
    });

    it('should return null when no curation tag present', () => {
      const tags = ['type:decision', 'confidence:high'];
      assert.strictEqual(parseCurationTag(tags), null);
    });

    it('should return null for invalid curation tag value', () => {
      const tags = ['curated:invalid'];
      assert.strictEqual(parseCurationTag(tags), null);
    });

    it('should return first valid mark if multiple present', () => {
      const tags = ['curated:draft', 'curated:authoritative'];
      assert.strictEqual(parseCurationTag(tags), 'draft');
    });

    it('should handle empty tag array', () => {
      assert.strictEqual(parseCurationTag([]), null);
    });
  });
});
