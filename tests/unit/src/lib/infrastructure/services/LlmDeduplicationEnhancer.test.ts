/**
 * LlmDeduplicationEnhancer Tests.
 *
 * Tests LLM-assisted semantic deduplication:
 * - Calls LLM with unclaimed facts only
 * - Parses JSON response into IDuplicateGroup
 * - Excludes facts already in existing groups
 * - Handles batching, cross-batch deduplication
 * - Graceful fallback on LLM failure
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createLlmDeduplicationEnhancer } from '../../../../../../src/lib/infrastructure/services/LlmDeduplicationEnhancer';
import type { ILlmGuard } from '../../../../../../src/lib/domain/interfaces/ILlmGuard';
import type { ILlmRequestOptions } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { LlmFeature } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';
import type { IMemoryItem } from '../../../../../../src/lib/domain/interfaces/types';
import type { IDuplicateGroup } from '../../../../../../src/lib/domain/interfaces/IDeduplicationService';

// ── Mock data ──────────────────────────────────────────────

function makeFact(uuid: string, fact: string, tags: string[] = []): IMemoryItem {
  return {
    uuid,
    fact,
    name: 'test',
    tags,
    created_at: '2026-01-15T00:00:00Z',
  };
}

// ── Mock LLM guard ─────────────────────────────────────────

interface IGuardCall { prompt: string; feature: LlmFeature; options?: ILlmRequestOptions }

function createMockLlmGuard(responseText?: string): ILlmGuard & { calls: IGuardCall[] } {
  const calls: IGuardCall[] = [];
  const text = responseText ?? JSON.stringify({
    groups: [],
  });

  return {
    calls,
    async complete(prompt: string, feature: LlmFeature, options?: ILlmRequestOptions) {
      calls.push({ prompt, feature, options });
      return {
        text,
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic' as const,
      };
    },
    async isFeatureEnabled() { return true; },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('LlmDeduplicationEnhancer', () => {
  describe('findSemanticDuplicates()', () => {
    it('should call LLM with deduplication feature', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'We decided to use PostgreSQL'),
        makeFact('a2', 'Database is Postgres with pgvector'),
      ];

      await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.feature, 'deduplication');
    });

    it('should exclude facts already in existing groups', async () => {
      const response = JSON.stringify({ groups: [] });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
        makeFact('a3', 'Fact three'),
      ];

      const existingGroups: IDuplicateGroup[] = [{
        reason: 'exact-match',
        facts: [facts[0]!, facts[1]!],
        similarity: 1.0,
      }];

      await enhancer.findSemanticDuplicates(facts, existingGroups);

      // Only 1 unclaimed fact (a3), which is < 2 → no LLM call
      assert.strictEqual(guard.calls.length, 0);
    });

    it('should return empty when fewer than 2 unclaimed facts', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [makeFact('a1', 'Only one fact')];
      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 0);
      assert.strictEqual(guard.calls.length, 0);
    });

    it('should parse LLM JSON response into groups', async () => {
      const response = JSON.stringify({
        groups: [
          {
            uuids: ['a1', 'a2'],
            reason: 'Both describe using PostgreSQL',
            suggestedMerge: 'We use PostgreSQL with pgvector for the database',
          },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'We decided to use PostgreSQL'),
        makeFact('a2', 'Database is Postgres with pgvector'),
        makeFact('a3', 'Unrelated fact about caching'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]?.reason, 'llm-semantic');
      assert.strictEqual(result[0]?.facts.length, 2);
      assert.strictEqual(result[0]?.suggestedMerge, 'We use PostgreSQL with pgvector for the database');
      assert.strictEqual(result[0]?.similarity, 0.8);
    });

    it('should assign reason llm-semantic to all groups', async () => {
      const response = JSON.stringify({
        groups: [
          { uuids: ['a1', 'a2'], reason: 'Same info', suggestedMerge: 'Merged' },
          { uuids: ['a3', 'a4'], reason: 'Same info', suggestedMerge: 'Merged' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
        makeFact('a3', 'Fact three'),
        makeFact('a4', 'Fact four'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 2);
      assert.ok(result.every(g => g.reason === 'llm-semantic'));
    });

    it('should include suggestedMerge from LLM', async () => {
      const response = JSON.stringify({
        groups: [
          { uuids: ['a1', 'a2'], reason: 'Same', suggestedMerge: 'Merged text here' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result[0]?.suggestedMerge, 'Merged text here');
    });

    it('should omit suggestedMerge when empty', async () => {
      const response = JSON.stringify({
        groups: [
          { uuids: ['a1', 'a2'], reason: 'Same', suggestedMerge: '' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result[0]?.suggestedMerge, undefined);
    });

    it('should deduplicate across batches (fact in at most one group)', async () => {
      const response = JSON.stringify({
        groups: [
          { uuids: ['a1', 'a2'], reason: 'Same', suggestedMerge: 'Merged' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      // Create enough facts to span 2 batches with batchSize=3
      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
        makeFact('a3', 'Fact three'),
        makeFact('a4', 'Fact four'),
        makeFact('a5', 'Fact five'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, [], { batchSize: 3 });

      // a1 and a2 claimed in first batch, should not appear in second batch results
      for (const group of result) {
        const uuids = group.facts.map(f => f.uuid);
        const uniqueUuids = new Set(uuids);
        assert.strictEqual(uuids.length, uniqueUuids.size, 'No duplicate UUIDs in a group');
      }
    });

    it('should batch facts by batchSize', async () => {
      const response = JSON.stringify({ groups: [] });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
        makeFact('a3', 'Fact three'),
        makeFact('a4', 'Fact four'),
        makeFact('a5', 'Fact five'),
      ];

      await enhancer.findSemanticDuplicates(facts, [], { batchSize: 3 });

      // 5 facts / batchSize 3 = 2 batches
      assert.strictEqual(guard.calls.length, 2);
    });

    it('should gracefully handle LLM failure', async () => {
      const guard: ILlmGuard = {
        async complete() {
          throw new Error('LLM provider unavailable');
        },
        async isFeatureEnabled() { return true; },
      };
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 0);
    });

    it('should handle malformed JSON response gracefully', async () => {
      const guard = createMockLlmGuard('Not valid JSON at all');
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 0);
    });

    it('should skip groups with fewer than 2 valid UUIDs', async () => {
      const response = JSON.stringify({
        groups: [
          { uuids: ['a1'], reason: 'Only one', suggestedMerge: '' },
          { uuids: ['a2', 'nonexistent-uuid'], reason: 'One unknown', suggestedMerge: '' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
        makeFact('a3', 'Fact three'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 0);
    });

    it('should respect maxFacts option', async () => {
      const response = JSON.stringify({ groups: [] });
      const guard = createMockLlmGuard(response);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = Array.from({ length: 50 }, (_, i) =>
        makeFact(`a${i}`, `Fact number ${i}`)
      );

      await enhancer.findSemanticDuplicates(facts, [], { maxFacts: 10, batchSize: 10 });

      // Should only process 10 facts, 1 batch
      assert.strictEqual(guard.calls.length, 1);
      // Prompt should only contain 10 facts
      const prompt = guard.calls[0]?.prompt ?? '';
      // Count fact lines (each starts with a number and period)
      const factLines = prompt.split('\n').filter(l => /^\d+\.\s/.test(l));
      assert.strictEqual(factLines.length, 10);
    });

    it('should use low temperature for deterministic analysis', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(guard.calls[0]?.options?.temperature, 0.2);
    });

    it('should include system prompt in LLM call', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      await enhancer.findSemanticDuplicates(facts, []);

      assert.ok(guard.calls[0]?.options?.systemPrompt);
      assert.ok(guard.calls[0]?.options?.systemPrompt?.includes('semantic duplicates'));
    });

    it('should handle JSON response with wrapper text', async () => {
      const jsonWithWrapper = 'Here is the analysis:\n' + JSON.stringify({
        groups: [
          { uuids: ['a1', 'a2'], reason: 'Same', suggestedMerge: 'Merged' },
        ],
      }) + '\n\nHope that helps!';
      const guard = createMockLlmGuard(jsonWithWrapper);
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one'),
        makeFact('a2', 'Fact two'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      assert.strictEqual(result.length, 1);
    });

    it('should include fact tags in the prompt', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts = [
        makeFact('a1', 'Fact one', ['redis', 'caching']),
        makeFact('a2', 'Fact two', ['database']),
      ];

      await enhancer.findSemanticDuplicates(facts, []);

      const prompt = guard.calls[0]?.prompt ?? '';
      assert.ok(prompt.includes('redis'));
      assert.ok(prompt.includes('caching'));
      assert.ok(prompt.includes('database'));
    });

    it('should skip facts without uuid', async () => {
      const guard = createMockLlmGuard();
      const enhancer = createLlmDeduplicationEnhancer(guard);

      const facts: IMemoryItem[] = [
        { fact: 'No uuid fact', name: 'test', created_at: '2026-01-15T00:00:00Z' },
        makeFact('a1', 'Has uuid'),
      ];

      const result = await enhancer.findSemanticDuplicates(facts, []);

      // Only 1 valid unclaimed fact → not enough for LLM call
      assert.strictEqual(result.length, 0);
      assert.strictEqual(guard.calls.length, 0);
    });
  });
});
