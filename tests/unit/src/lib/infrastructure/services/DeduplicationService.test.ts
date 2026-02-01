/**
 * Tests for DeduplicationService.
 *
 * Tests the three-pass deduplication detection algorithm:
 * - Pass 1: Exact match (normalized text)
 * - Pass 2: Tag overlap (shared type tags + 3+ common words)
 * - Pass 3: Similar content (Jaccard word-set similarity)
 *
 * Also tests helper functions: normalizeText, extractWords, jaccardSimilarity.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeText,
  extractWords,
  jaccardSimilarity,
  detectDuplicatesFromFacts,
} from '../../../../../../src/lib/infrastructure/services/DeduplicationService';
import type { IMemoryItem } from '../../../../../../src/lib/domain/interfaces/types';
import type { IConflictGroup } from '../../../../../../src/lib/domain/interfaces/dal/types';

function makeFact(overrides: Partial<IMemoryItem> & { uuid: string; fact: string }): IMemoryItem {
  return {
    name: overrides.name ?? 'test',
    created_at: overrides.created_at ?? '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('DeduplicationService', () => {
  describe('normalizeText()', () => {
    it('should lowercase text', () => {
      assert.strictEqual(normalizeText('HELLO World'), 'hello world');
    });

    it('should trim whitespace', () => {
      assert.strictEqual(normalizeText('  hello  '), 'hello');
    });

    it('should collapse multiple spaces', () => {
      assert.strictEqual(normalizeText('hello   world   test'), 'hello world test');
    });

    it('should handle tabs and newlines', () => {
      assert.strictEqual(normalizeText('hello\t\nworld'), 'hello world');
    });

    it('should handle empty string', () => {
      assert.strictEqual(normalizeText(''), '');
    });
  });

  describe('extractWords()', () => {
    it('should extract meaningful words', () => {
      const words = extractWords('The database connection pool is configured');
      assert.ok(words.has('database'));
      assert.ok(words.has('connection'));
      assert.ok(words.has('pool'));
      assert.ok(words.has('configured'));
    });

    it('should remove stop words', () => {
      const words = extractWords('the a an is was are in for on with');
      assert.strictEqual(words.size, 0);
    });

    it('should remove single-character words', () => {
      const words = extractWords('a b c x y z database');
      assert.strictEqual(words.size, 1);
      assert.ok(words.has('database'));
    });

    it('should remove punctuation', () => {
      const words = extractWords('hello, world! database; pool.');
      assert.ok(words.has('hello'));
      assert.ok(words.has('world'));
      assert.ok(words.has('database'));
      assert.ok(words.has('pool'));
    });

    it('should return empty set for empty string', () => {
      const words = extractWords('');
      assert.strictEqual(words.size, 0);
    });

    it('should be case-insensitive', () => {
      const words = extractWords('Database CONNECTION Pool');
      assert.ok(words.has('database'));
      assert.ok(words.has('connection'));
      assert.ok(words.has('pool'));
    });
  });

  describe('jaccardSimilarity()', () => {
    it('should return 1.0 for identical sets', () => {
      const a = new Set(['hello', 'world']);
      const b = new Set(['hello', 'world']);
      assert.strictEqual(jaccardSimilarity(a, b), 1.0);
    });

    it('should return 0.0 for disjoint sets', () => {
      const a = new Set(['hello', 'world']);
      const b = new Set(['foo', 'bar']);
      assert.strictEqual(jaccardSimilarity(a, b), 0.0);
    });

    it('should return correct similarity for partial overlap', () => {
      const a = new Set(['hello', 'world', 'foo']);
      const b = new Set(['hello', 'world', 'bar']);
      // intersection: 2, union: 4 → 0.5
      assert.strictEqual(jaccardSimilarity(a, b), 0.5);
    });

    it('should return 0.0 for two empty sets', () => {
      assert.strictEqual(jaccardSimilarity(new Set(), new Set()), 0.0);
    });

    it('should return 0.0 when one set is empty', () => {
      const a = new Set(['hello']);
      assert.strictEqual(jaccardSimilarity(a, new Set()), 0.0);
    });

    it('should handle subset relationship', () => {
      const a = new Set(['hello', 'world']);
      const b = new Set(['hello', 'world', 'foo', 'bar']);
      // intersection: 2, union: 4 → 0.5
      assert.strictEqual(jaccardSimilarity(a, b), 0.5);
    });
  });

  describe('detectDuplicatesFromFacts()', () => {
    describe('Pass 1 — Exact match', () => {
      it('should detect identical facts', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Use PostgreSQL for storage' }),
          makeFact({ uuid: 'a2', fact: 'Use PostgreSQL for storage' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'exact-match');
        assert.strictEqual(result[0].similarity, 1.0);
        assert.strictEqual(result[0].facts.length, 2);
      });

      it('should detect case-insensitive matches', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Use PostgreSQL for storage' }),
          makeFact({ uuid: 'a2', fact: 'use postgresql for storage' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'exact-match');
      });

      it('should detect whitespace-normalized matches', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Use  PostgreSQL   for storage' }),
          makeFact({ uuid: 'a2', fact: 'Use PostgreSQL for storage' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'exact-match');
      });

      it('should group 3+ identical facts together', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Same fact text' }),
          makeFact({ uuid: 'a2', fact: 'Same fact text' }),
          makeFact({ uuid: 'a3', fact: 'Same fact text' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].facts.length, 3);
      });

      it('should not group single facts', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Unique fact one' }),
          makeFact({ uuid: 'a2', fact: 'Unique fact two' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 0);
      });
    });

    describe('Pass 2 — Tag overlap', () => {
      it('should detect tag overlap with 3+ common words', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Database connection pooling configured with max 10' }),
          makeFact({ uuid: 'a2', fact: 'Database connection pooling uses limit of 20' }),
        ];
        const conflictGroups: IConflictGroup[] = [{
          topic: 'type:config',
          facts: facts,
          detectedAt: '2026-01-15T00:00:00Z',
        }];
        const result = detectDuplicatesFromFacts(facts, conflictGroups, {});
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'tag-overlap');
        assert.ok(result[0].similarity >= 0.5);
        assert.ok(result[0].similarity <= 0.8);
      });

      it('should not detect tag overlap with fewer than 3 common words', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Database configured' }),
          makeFact({ uuid: 'a2', fact: 'Server deployed' }),
        ];
        const conflictGroups: IConflictGroup[] = [{
          topic: 'type:config',
          facts: facts,
          detectedAt: '2026-01-15T00:00:00Z',
        }];
        const result = detectDuplicatesFromFacts(facts, conflictGroups, {});
        assert.strictEqual(result.length, 0);
      });

      it('should skip facts already claimed by exact match', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Database connection pooling configured' }),
          makeFact({ uuid: 'a2', fact: 'Database connection pooling configured' }),
        ];
        const conflictGroups: IConflictGroup[] = [{
          topic: 'type:config',
          facts: facts,
          detectedAt: '2026-01-15T00:00:00Z',
        }];
        const result = detectDuplicatesFromFacts(facts, conflictGroups, {});
        // Should only have exact-match group, not tag-overlap
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'exact-match');
      });
    });

    describe('Pass 3 — Similar content (Jaccard)', () => {
      it('should detect similar content above threshold', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Configure the database connection pool with maximum connections' }),
          makeFact({ uuid: 'a2', fact: 'Configure the database connection pool settings for production' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], { minSimilarity: 0.4 });
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'similar-content');
        assert.ok(result[0].similarity >= 0.4);
      });

      it('should exclude pairs below threshold', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'Configure database pool connections maximum' }),
          makeFact({ uuid: 'a2', fact: 'Deploy application server production environment' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], { minSimilarity: 0.6 });
        assert.strictEqual(result.length, 0);
      });

      it('should build transitive groups', () => {
        // A is similar to B, B is similar to C → all in one group
        const facts = [
          makeFact({ uuid: 'a1', fact: 'database connection pool maximum settings configuration' }),
          makeFact({ uuid: 'a2', fact: 'database connection pool configuration timeout limits' }),
          makeFact({ uuid: 'a3', fact: 'connection pool configuration timeout maximum retry' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], { minSimilarity: 0.2 });
        // All three should be in a single group (transitive)
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].facts.length, 3);
      });
    });

    describe('Options and edge cases', () => {
      it('should apply limit to output groups', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'exact one' }),
          makeFact({ uuid: 'a2', fact: 'exact one' }),
          makeFact({ uuid: 'b1', fact: 'exact two' }),
          makeFact({ uuid: 'b2', fact: 'exact two' }),
          makeFact({ uuid: 'c1', fact: 'exact three' }),
          makeFact({ uuid: 'c2', fact: 'exact three' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], { limit: 2 });
        assert.strictEqual(result.length, 2);
      });

      it('should return empty array for empty facts', () => {
        const result = detectDuplicatesFromFacts([], [], {});
        assert.strictEqual(result.length, 0);
      });

      it('should return empty array for single fact', () => {
        const facts = [makeFact({ uuid: 'a1', fact: 'Only one fact' })];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 0);
      });

      it('should skip facts without uuid', () => {
        const facts = [
          { fact: 'No uuid fact one' } as IMemoryItem,
          { fact: 'No uuid fact one' } as IMemoryItem,
        ];
        const result = detectDuplicatesFromFacts(facts, [], {});
        assert.strictEqual(result.length, 0);
      });

      it('should skip facts without fact text', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: '' }),
          makeFact({ uuid: 'a2', fact: '' }),
        ];
        // Empty normalized text still matches, but fact text is empty
        // The algorithm groups by normalized text, empty strings match
        // This is acceptable — empty facts are duplicates
        const result = detectDuplicatesFromFacts(facts, [], {});
        // Both have empty fact, which normalizes to '', should skip
        // Actually the check is `if (!fact.fact || !fact.uuid)` so empty strings are skipped
        assert.strictEqual(result.length, 0);
      });

      it('should sort groups by similarity descending', () => {
        const facts = [
          // Exact match (similarity 1.0)
          makeFact({ uuid: 'a1', fact: 'exact duplicate' }),
          makeFact({ uuid: 'a2', fact: 'exact duplicate' }),
          // Similar content (similarity < 1.0)
          makeFact({ uuid: 'b1', fact: 'configure database connection pool maximum settings' }),
          makeFact({ uuid: 'b2', fact: 'configure database connection pool timeout settings' }),
        ];
        const result = detectDuplicatesFromFacts(facts, [], { minSimilarity: 0.3 });
        assert.ok(result.length >= 2);
        assert.ok(result[0].similarity >= result[1].similarity);
      });

      it('should ensure a fact appears in at most one group', () => {
        // Fact 'a1' could match both exact and tag-overlap
        const fact1 = makeFact({ uuid: 'a1', fact: 'Database connection pool configured' });
        const fact2 = makeFact({ uuid: 'a2', fact: 'Database connection pool configured' });
        const conflictGroups: IConflictGroup[] = [{
          topic: 'type:config',
          facts: [fact1, fact2],
          detectedAt: '2026-01-15T00:00:00Z',
        }];
        const result = detectDuplicatesFromFacts([fact1, fact2], conflictGroups, {});
        // Should only be in exact-match group (claimed first)
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].reason, 'exact-match');
      });

      it('should handle default options', () => {
        const facts = [
          makeFact({ uuid: 'a1', fact: 'same text' }),
          makeFact({ uuid: 'a2', fact: 'same text' }),
        ];
        // No options passed — should use defaults
        const result = detectDuplicatesFromFacts(facts, []);
        assert.strictEqual(result.length, 1);
      });
    });
  });
});

// ── createDeduplicationService integration tests ────────

import { createDeduplicationService } from '../../../../../../src/lib/infrastructure/services/DeduplicationService';
import type { IMemoryServiceWithQuality } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { ILlmDeduplicationEnhancer } from '../../../../../../src/lib/infrastructure/services/LlmDeduplicationEnhancer';
import type { IDuplicateGroup } from '../../../../../../src/lib/domain/interfaces/IDeduplicationService';

/** Only the methods exercised by createDeduplicationService. */
type MockedMemoryService = Pick<IMemoryServiceWithQuality, 'loadFactsDateOrdered' | 'findConflicts'>;

function createMockMemoryService(facts: IMemoryItem[]): IMemoryServiceWithQuality {
  const mock: MockedMemoryService = {
    async loadFactsDateOrdered() { return facts; },
    async findConflicts() { return []; },
  };
  return mock as IMemoryServiceWithQuality;
}

describe('createDeduplicationService (LLM integration)', () => {
  it('should return algorithmic results when no enhancer provided', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'exact duplicate text' }),
      makeFact({ uuid: 'a2', fact: 'exact duplicate text' }),
    ];
    const mockMemory = createMockMemoryService(facts);
    const service = createDeduplicationService(mockMemory);

    const result = await service.detectDuplicates('test-group');

    assert.ok(result.duplicateGroups.length >= 1);
    assert.strictEqual(result.duplicateGroups[0]?.reason, 'exact-match');
  });

  it('should skip LLM pass when aiAssist is false', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'We decided to use PostgreSQL' }),
      makeFact({ uuid: 'a2', fact: 'Database is Postgres with pgvector' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    let llmCalled = false;
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        llmCalled = true;
        return [];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    await service.detectDuplicates('test-group', { aiAssist: false });

    assert.strictEqual(llmCalled, false);
  });

  it('should skip LLM pass when aiAssist is not set (default false)', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'fact one' }),
      makeFact({ uuid: 'a2', fact: 'fact two' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    let llmCalled = false;
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        llmCalled = true;
        return [];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    await service.detectDuplicates('test-group');

    assert.strictEqual(llmCalled, false);
  });

  it('should run LLM 4th pass when aiAssist is true', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'We decided to use PostgreSQL' }),
      makeFact({ uuid: 'a2', fact: 'Database is Postgres with pgvector' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    let llmCalled = false;
    const llmGroup: IDuplicateGroup = {
      reason: 'llm-semantic',
      facts,
      similarity: 0.8,
      suggestedMerge: 'We use PostgreSQL with pgvector',
    };
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        llmCalled = true;
        return [llmGroup];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    const result = await service.detectDuplicates('test-group', { aiAssist: true });

    assert.strictEqual(llmCalled, true);
    assert.ok(result.duplicateGroups.some(g => g.reason === 'llm-semantic'));
  });

  it('should append LLM groups after algorithmic groups', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'exact duplicate' }),
      makeFact({ uuid: 'a2', fact: 'exact duplicate' }),
      makeFact({ uuid: 'b1', fact: 'We decided to use PostgreSQL' }),
      makeFact({ uuid: 'b2', fact: 'Database is Postgres with pgvector' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    const llmGroup: IDuplicateGroup = {
      reason: 'llm-semantic',
      facts: [facts[2]!, facts[3]!],
      similarity: 0.8,
      suggestedMerge: 'We use PostgreSQL with pgvector',
    };
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        return [llmGroup];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    const result = await service.detectDuplicates('test-group', { aiAssist: true, limit: 20 });

    // Both algorithmic and LLM groups present
    const reasons = result.duplicateGroups.map(g => g.reason);
    assert.ok(reasons.includes('exact-match'));
    assert.ok(reasons.includes('llm-semantic'));
  });

  it('should sort combined results by similarity descending', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'different text one' }),
      makeFact({ uuid: 'a2', fact: 'different text two' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    const llmGroup: IDuplicateGroup = {
      reason: 'llm-semantic',
      facts,
      similarity: 0.9,
    };
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        return [llmGroup];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    const result = await service.detectDuplicates('test-group', { aiAssist: true });

    // Verify descending similarity order
    for (let i = 1; i < result.duplicateGroups.length; i++) {
      assert.ok(result.duplicateGroups[i - 1]!.similarity >= result.duplicateGroups[i]!.similarity);
    }
  });

  it('should gracefully handle LLM enhancer failure', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'exact dup' }),
      makeFact({ uuid: 'a2', fact: 'exact dup' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        throw new Error('LLM provider unavailable');
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    const result = await service.detectDuplicates('test-group', { aiAssist: true });

    // Should still return algorithmic results
    assert.ok(result.duplicateGroups.length >= 1);
    assert.strictEqual(result.duplicateGroups[0]?.reason, 'exact-match');
  });

  it('should respect limit on combined results', async () => {
    const facts = [
      makeFact({ uuid: 'a1', fact: 'exact one' }),
      makeFact({ uuid: 'a2', fact: 'exact one' }),
      makeFact({ uuid: 'b1', fact: 'semantic dup 1' }),
      makeFact({ uuid: 'b2', fact: 'semantic dup 2' }),
    ];
    const mockMemory = createMockMemoryService(facts);

    const llmGroup: IDuplicateGroup = {
      reason: 'llm-semantic',
      facts: [facts[2]!, facts[3]!],
      similarity: 0.8,
    };
    const mockEnhancer: ILlmDeduplicationEnhancer = {
      async findSemanticDuplicates() {
        return [llmGroup];
      },
    };

    const service = createDeduplicationService(mockMemory, mockEnhancer);
    const result = await service.detectDuplicates('test-group', { aiAssist: true, limit: 1 });

    assert.strictEqual(result.duplicateGroups.length, 1);
  });
});
