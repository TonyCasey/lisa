/**
 * Tests for SessionContextFormatter priority display (#181).
 *
 * Tests confidence indicators, priority grouping, per-tier truncation,
 * and backward compatibility (ranked: false).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { IMemoryItem } from '../../../../../../src/lib/domain';
import { SessionContextFormatter } from '../../../../../../src/lib/application/services/SessionContextFormatter';

function createItem(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: `item-${Math.random().toString(36).slice(2, 8)}`,
    fact: 'Test fact',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('SessionContextFormatter — priority display (#181)', () => {
  describe('getConfidenceIndicator', () => {
    it('should return [V] for verified confidence', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['confidence:verified'] });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '[V]');
    });

    it('should return [H] for high confidence', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['confidence:high'] });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '[H]');
    });

    it('should return [M] for medium confidence', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['confidence:medium'] });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '[M]');
    });

    it('should return empty for low confidence', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['confidence:low'] });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '');
    });

    it('should return empty when no confidence tag', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['type:prompt'] });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '');
    });

    it('should return empty when tags are undefined', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: undefined });

      assert.strictEqual(formatter.getConfidenceIndicator(item), '');
    });
  });

  describe('assignTier', () => {
    it('should assign Tier 1 for verified confidence', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['confidence:verified'] });

      assert.strictEqual(formatter.assignTier(item), 1);
    });

    it('should assign Tier 2 for user-explicit source', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['source:user-explicit'] });

      assert.strictEqual(formatter.assignTier(item), 2);
    });

    it('should assign Tier 3 for high confidence within 48h', () => {
      const formatter = new SessionContextFormatter();
      const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const item = createItem({ tags: ['confidence:high'], created_at: recentDate });

      assert.strictEqual(formatter.assignTier(item), 3);
    });

    it('should assign Tier 4 for active tasks', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['type:task', 'status:in-progress'] });

      assert.strictEqual(formatter.assignTier(item), 4);
    });

    it('should assign Tier 5 for medium confidence within 24h', () => {
      const formatter = new SessionContextFormatter();
      const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const item = createItem({ tags: ['confidence:medium'], created_at: recentDate });

      assert.strictEqual(formatter.assignTier(item), 5);
    });

    it('should assign Tier 6 for everything else', () => {
      const formatter = new SessionContextFormatter();
      const item = createItem({ tags: ['type:prompt'] });

      assert.strictEqual(formatter.assignTier(item), 6);
    });
  });

  describe('formatRankedMemories', () => {
    it('should group facts into Key facts, Recent context, and Background', () => {
      const formatter = new SessionContextFormatter();
      const recentDate = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const items = [
        createItem({ fact: 'Verified fact', tags: ['confidence:verified'] }),
        createItem({ fact: 'Medium fact', tags: ['confidence:medium'], created_at: recentDate }),
        createItem({ fact: 'Background fact', tags: [] }),
      ];

      const lines = formatter.formatRankedMemories(items);

      assert.ok(lines.some(l => l === 'Key facts:'), 'Should have Key facts section');
      assert.ok(lines.some(l => l === 'Recent context:'), 'Should have Recent context section');
      assert.ok(lines.some(l => l === 'Background:'), 'Should have Background section');
    });

    it('should include confidence indicators in output', () => {
      const formatter = new SessionContextFormatter();
      const items = [
        createItem({ fact: 'Verified fact', tags: ['confidence:verified'] }),
        createItem({ fact: 'High fact', tags: ['confidence:high'], created_at: new Date().toISOString() }),
      ];

      const lines = formatter.formatRankedMemories(items);
      const verifiedLine = lines.find(l => l.includes('Verified fact'));
      const highLine = lines.find(l => l.includes('High fact'));

      assert.ok(verifiedLine?.includes('[V]'), 'Should have [V] indicator');
      assert.ok(highLine?.includes('[H]'), 'Should have [H] indicator');
    });

    it('should truncate groups at 10 items with +N more', () => {
      const formatter = new SessionContextFormatter();
      const items: IMemoryItem[] = [];
      for (let i = 0; i < 15; i++) {
        items.push(createItem({ fact: `Background ${i}`, tags: [] }));
      }

      const lines = formatter.formatRankedMemories(items);

      const moreLine = lines.find(l => l.includes('... and'));
      assert.ok(moreLine, 'Should have truncation indicator');
      assert.ok(moreLine?.includes('5 more'), 'Should show 5 more');
    });

    it('should return empty array for empty input', () => {
      const formatter = new SessionContextFormatter();
      const lines = formatter.formatRankedMemories([]);

      assert.strictEqual(lines.length, 0);
    });

    it('should skip empty groups', () => {
      const formatter = new SessionContextFormatter();
      // Only background facts, no key facts or recent context
      const items = [
        createItem({ fact: 'Background', tags: [] }),
      ];

      const lines = formatter.formatRankedMemories(items);

      assert.ok(!lines.some(l => l === 'Key facts:'), 'Should not have Key facts section');
      assert.ok(!lines.some(l => l === 'Recent context:'), 'Should not have Recent context section');
      assert.ok(lines.some(l => l === 'Background:'), 'Should have Background section');
    });
  });

  describe('formatContextContent backward compatibility', () => {
    it('should use time-grouped display when ranked is false', () => {
      const formatter = new SessionContextFormatter();
      const result = formatter.formatContextContent(
        'startup',
        {
          facts: [createItem({ fact: 'A fact', created_at: new Date().toISOString() })],
          nodes: [],
          initReview: null,
          timedOut: false,
        },
        [],
        { ready: 0, 'in-progress': 0, blocked: 0, done: 0, closed: 0, unknown: 0 },
        {
          projectName: 'test',
          userName: 'user',
          folderType: 'TypeScript',
          projectRoot: '/test',
          branch: 'main',
        },
        [],
        undefined,
        false // ranked: false
      );

      assert.ok(result.includes('Recent memories'), 'Should use time-grouped format');
      assert.ok(!result.includes('Key facts'), 'Should not use ranked format');
    });

    it('should use ranked display when ranked is true', () => {
      const formatter = new SessionContextFormatter();
      const result = formatter.formatContextContent(
        'startup',
        {
          facts: [
            createItem({ fact: 'Verified', tags: ['confidence:verified'] }),
            createItem({ fact: 'Background', tags: [] }),
          ],
          nodes: [],
          initReview: null,
          timedOut: false,
        },
        [],
        { ready: 0, 'in-progress': 0, blocked: 0, done: 0, closed: 0, unknown: 0 },
        {
          projectName: 'test',
          userName: 'user',
          folderType: 'TypeScript',
          projectRoot: '/test',
          branch: 'main',
        },
        [],
        undefined,
        true // ranked: true
      );

      assert.ok(!result.includes('Recent memories'), 'Should not use time-grouped format');
      assert.ok(result.includes('Key facts'), 'Should use ranked format');
      assert.ok(result.includes('[V]'), 'Should have verified indicator');
    });

    it('should default to time-grouped display when ranked is undefined', () => {
      const formatter = new SessionContextFormatter();
      const result = formatter.formatContextContent(
        'startup',
        {
          facts: [createItem({ fact: 'A fact', created_at: new Date().toISOString() })],
          nodes: [],
          initReview: null,
          timedOut: false,
        },
        [],
        { ready: 0, 'in-progress': 0, blocked: 0, done: 0, closed: 0, unknown: 0 },
        {
          projectName: 'test',
          userName: 'user',
          folderType: 'TypeScript',
          projectRoot: '/test',
          branch: 'main',
        }
        // ranked parameter omitted
      );

      assert.ok(result.includes('Recent memories'), 'Should default to time-grouped format');
    });
  });
});
