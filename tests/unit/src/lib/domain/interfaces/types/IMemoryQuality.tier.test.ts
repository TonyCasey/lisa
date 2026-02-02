/**
 * Tests for computeMemoryTier.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { IMemoryItem } from '../../../../../../../src/lib/domain/interfaces/types/IMemoryResult';
import { computeMemoryTier } from '../../../../../../../src/lib/domain/interfaces/types/IMemoryQuality';

function createItem(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: `item-${Math.random().toString(36).slice(2, 8)}`,
    fact: 'Test fact',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeMemoryTier', () => {
  it('returns Tier 1 for verified confidence', () => {
    const item = createItem({ tags: ['confidence:verified'] });
    assert.strictEqual(computeMemoryTier(item), 1);
  });

  it('returns Tier 2 for user-explicit source', () => {
    const item = createItem({ tags: ['source:user-explicit'] });
    assert.strictEqual(computeMemoryTier(item), 2);
  });

  it('returns Tier 3 for high confidence within 48h', () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const item = createItem({ tags: ['confidence:high'], created_at: recent });
    assert.strictEqual(computeMemoryTier(item), 3);
  });

  it('returns Tier 4 for active tasks', () => {
    const item = createItem({ tags: ['type:task', 'status:in-progress'] });
    assert.strictEqual(computeMemoryTier(item), 4);
  });

  it('returns Tier 5 for medium confidence within 24h', () => {
    const recent = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const item = createItem({ tags: ['confidence:medium'], created_at: recent });
    assert.strictEqual(computeMemoryTier(item), 5);
  });

  it('returns Tier 6 for everything else', () => {
    const item = createItem({ tags: ['confidence:low'] });
    assert.strictEqual(computeMemoryTier(item), 6);
  });
});
