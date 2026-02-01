/**
 * SummarizationService Tests.
 *
 * Tests fact loading, LLM prompt construction, response parsing,
 * topic/date filtering, and empty fact handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSummarizationService } from '../../../../../../src/lib/infrastructure/services/SummarizationService';
import type { ILlmGuard } from '../../../../../../src/lib/domain/interfaces/ILlmGuard';
import type { ILlmRequestOptions } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { IMemoryService, IMemoryDateOptions } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { IMemoryItem, IMemoryResult } from '../../../../../../src/lib/domain/interfaces/types';
import type { LlmFeature } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';

// ── Mock data ──────────────────────────────────────────────

const mockFacts: IMemoryItem[] = [
  {
    uuid: 'f1',
    fact: 'We decided to use PostgreSQL for the database',
    tags: ['type:decision', 'topic:database'],
    created_at: '2025-01-10T10:00:00.000Z',
  },
  {
    uuid: 'f2',
    fact: 'The API uses Express.js with TypeScript',
    tags: ['type:convention', 'topic:api'],
    created_at: '2025-01-11T10:00:00.000Z',
  },
  {
    uuid: 'f3',
    fact: 'Authentication uses JWT tokens with refresh rotation',
    tags: ['type:decision', 'topic:auth'],
    created_at: '2025-01-12T10:00:00.000Z',
  },
];

// ── Mock memory service ────────────────────────────────────

interface ILoadCall { groupIds: readonly string[]; limit?: number; options?: IMemoryDateOptions }
interface ISearchCall { groupIds: readonly string[]; query: string; limit?: number }

function createMockMemoryService(facts: IMemoryItem[] = mockFacts): IMemoryService & { loadCalls: ILoadCall[]; searchCalls: ISearchCall[] } {
  const loadCalls: ILoadCall[] = [];
  const searchCalls: ISearchCall[] = [];

  return {
    loadCalls,
    searchCalls,

    async loadMemory() {
      return { facts: [], nodes: [], tasks: [], initReview: null, timedOut: false } as IMemoryResult;
    },
    async loadFactsDateOrdered(groupIds: readonly string[], limit?: number, options?: IMemoryDateOptions) {
      loadCalls.push({ groupIds, limit, options });
      return facts.slice(0, limit ?? facts.length);
    },
    async searchFacts(groupIds: readonly string[], query: string, limit?: number) {
      searchCalls.push({ groupIds, query, limit });
      // Simulate search by filtering on topic tag
      return facts
        .filter(f => f.tags?.some(t => t.includes(query)) || f.fact?.includes(query))
        .slice(0, limit ?? facts.length);
    },
    async saveMemory() { /* no-op */ },
    async addFact() { /* no-op */ },
    async addFactWithLifecycle() { /* no-op */ },
    async expireFact() { /* no-op */ },
    async cleanupExpired() { return 0; },
  };
}

// ── Mock LLM guard ─────────────────────────────────────────

interface IGuardCall { prompt: string; feature: LlmFeature; options?: ILlmRequestOptions }

function createMockLlmGuard(responseText?: string): ILlmGuard & { calls: IGuardCall[] } {
  const calls: IGuardCall[] = [];
  const text = responseText ?? [
    'The project uses PostgreSQL for data storage and Express.js with TypeScript for the API layer.',
    'Authentication is handled via JWT tokens with refresh rotation for security.',
    '',
    'TOPICS: ["database", "api", "authentication"]',
  ].join('\n');

  return {
    calls,
    async complete(prompt: string, feature: LlmFeature, options?: ILlmRequestOptions) {
      calls.push({ prompt, feature, options });
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic' as const,
      };
    },
    async isFeatureEnabled() { return true; },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('SummarizationService', () => {
  describe('summarize()', () => {
    it('should load facts and call LLM', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');

      // Should have loaded facts
      assert.strictEqual(memory.loadCalls.length, 1);
      assert.deepStrictEqual(memory.loadCalls[0]?.groupIds, ['group-1']);

      // Should have called LLM
      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.feature, 'summarization');

      // Should return structured result
      assert.ok(result.summary.length > 0);
      assert.strictEqual(result.factCount, 3);
      assert.ok(result.topics.length > 0);
    });

    it('should parse topics from LLM response', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.deepStrictEqual([...result.topics], ['database', 'api', 'authentication']);
    });

    it('should extract summary text without TOPICS line', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard(
        'This is the summary.\n\nTOPICS: ["topic1"]'
      );
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.strictEqual(result.summary, 'This is the summary.');
    });

    it('should return time range from facts', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.strictEqual(result.timeRange.from, '2025-01-10T10:00:00.000Z');
      assert.strictEqual(result.timeRange.to, '2025-01-12T10:00:00.000Z');
    });

    it('should return usage stats from LLM response', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.strictEqual(result.usage.inputTokens, 100);
      assert.strictEqual(result.usage.outputTokens, 50);
      assert.strictEqual(result.usage.totalTokens, 150);
    });

    it('should use searchFacts when topic is provided', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      await svc.summarize('group-1', { topic: 'database' });

      assert.strictEqual(memory.searchCalls.length, 1);
      assert.strictEqual(memory.searchCalls[0]?.query, 'database');
      assert.strictEqual(memory.loadCalls.length, 0);
    });

    it('should pass since option as date filter', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const since = new Date('2025-01-11T00:00:00.000Z');
      await svc.summarize('group-1', { since });

      assert.strictEqual(memory.loadCalls.length, 1);
      assert.strictEqual(memory.loadCalls[0]?.options?.since, since);
    });

    it('should cap facts at maxFacts limit', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      await svc.summarize('group-1', { maxFacts: 2 });

      assert.strictEqual(memory.loadCalls.length, 1);
      assert.strictEqual(memory.loadCalls[0]?.limit, 2);
    });

    it('should return empty result for no facts', async () => {
      const memory = createMockMemoryService([]);
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');

      assert.strictEqual(result.factCount, 0);
      assert.ok(result.summary.includes('No facts found'));
      assert.strictEqual(result.topics.length, 0);
      assert.strictEqual(guard.calls.length, 0); // Should NOT call LLM
    });

    it('should use higher maxTokens for detailed style', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      await svc.summarize('group-1', { style: 'detailed' });

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 2048);
    });

    it('should use lower maxTokens for concise style', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      await svc.summarize('group-1', { style: 'concise' });

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 1024);
    });

    it('should handle LLM response without TOPICS line', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard('Just a plain summary without topics.');
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.strictEqual(result.summary, 'Just a plain summary without topics.');
      assert.strictEqual(result.topics.length, 0);
    });

    it('should handle LLM response with malformed TOPICS JSON', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard('Summary text\n\nTOPICS: not-valid-json');
      const svc = createSummarizationService(memory, guard);

      const result = await svc.summarize('group-1');
      assert.strictEqual(result.summary, 'Summary text');
      assert.strictEqual(result.topics.length, 0);
    });

    it('should propagate LLM guard errors to caller', async () => {
      const memory = createMockMemoryService();
      const guard: ILlmGuard & { calls: unknown[] } = {
        calls: [],
        async complete() {
          throw new Error('LLM provider unavailable');
        },
        async isFeatureEnabled() { return true; },
      };
      const svc = createSummarizationService(memory, guard);

      await assert.rejects(
        async () => svc.summarize('group-1'),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes('LLM provider unavailable'));
          return true;
        }
      );
    });

    it('should apply since filter when topic is also provided', async () => {
      // Create facts where two match 'decision' but only one is after the since date
      const factsWithDates: IMemoryItem[] = [
        { uuid: 'old', fact: 'Old decision about X', tags: ['type:decision'], created_at: '2025-01-05T10:00:00.000Z' },
        { uuid: 'new', fact: 'New decision about Y', tags: ['type:decision'], created_at: '2025-01-15T10:00:00.000Z' },
      ];
      const memory = createMockMemoryService(factsWithDates);
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      const since = new Date('2025-01-10T00:00:00.000Z');
      const result = await svc.summarize('group-1', { topic: 'decision', since });

      // searchFacts should be called (topic path)
      assert.strictEqual(memory.searchCalls.length, 1);
      // Both facts match 'decision', but only 'new' is after since date
      assert.strictEqual(result.factCount, 1);
      assert.strictEqual(guard.calls.length, 1);
    });

    it('should include system prompt in LLM call', async () => {
      const memory = createMockMemoryService();
      const guard = createMockLlmGuard();
      const svc = createSummarizationService(memory, guard);

      await svc.summarize('group-1');

      assert.strictEqual(guard.calls.length, 1);
      assert.ok(guard.calls[0]?.options?.systemPrompt);
      assert.ok(guard.calls[0]?.options?.systemPrompt.includes('knowledge base curator'));
    });
  });
});
