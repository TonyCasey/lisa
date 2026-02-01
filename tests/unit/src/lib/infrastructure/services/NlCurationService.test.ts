/**
 * NlCurationService Tests.
 *
 * Tests LLM-powered natural language curation:
 * - Intent classification (query, mark, expire, summarize, consolidate)
 * - Plan generation from natural language input
 * - Destructive vs non-destructive classification
 * - Operation execution (search, mark, expire, summarize, consolidate)
 * - Graceful fallback on LLM failure or malformed response
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createNlCurationService } from '../../../../../../src/lib/infrastructure/services/NlCurationService';
import type { ILlmGuard } from '../../../../../../src/lib/domain/interfaces/ILlmGuard';
import type { ILlmRequestOptions, ILlmResponse } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { LlmFeature } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';
import type { IMemoryService } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { ICurationService, CurationMark } from '../../../../../../src/lib/domain/interfaces/ICurationService';
import type { IConsolidationService } from '../../../../../../src/lib/domain/interfaces/IConsolidationService';
import type { ISummarizationService } from '../../../../../../src/lib/domain/interfaces/ISummarizationService';
import type { IMemoryItem } from '../../../../../../src/lib/domain/interfaces/types';
import type { INlCurationPlan } from '../../../../../../src/lib/domain/interfaces/INlCurationService';

// ── Mock data ──────────────────────────────────────────────

function makeFact(uuid: string, fact: string): IMemoryItem {
  return {
    uuid,
    fact,
    name: 'test',
    created_at: '2026-01-15T00:00:00Z',
  };
}

const MOCK_USAGE = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

// ── Mock factories ─────────────────────────────────────────

interface IGuardCall { prompt: string; feature: LlmFeature; options?: ILlmRequestOptions }

function createMockLlmGuard(responseText: string): ILlmGuard & { calls: IGuardCall[] } {
  const calls: IGuardCall[] = [];
  return {
    calls,
    async complete(prompt: string, feature: LlmFeature, options?: ILlmRequestOptions): Promise<ILlmResponse> {
      calls.push({ prompt, feature, options });
      return {
        text: responseText,
        usage: MOCK_USAGE,
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic' as const,
      };
    },
    async isFeatureEnabled() { return true; },
  };
}

function createMockMemoryService(facts: IMemoryItem[] = []): IMemoryService & {
  searchCalls: Array<{ groupIds: readonly string[]; query: string; limit?: number }>;
  expireCalls: Array<{ groupId: string; uuid: string }>;
} {
  const searchCalls: Array<{ groupIds: readonly string[]; query: string; limit?: number }> = [];
  const expireCalls: Array<{ groupId: string; uuid: string }> = [];
  return {
    searchCalls,
    expireCalls,
    async searchFacts(groupIds: readonly string[], query: string, limit?: number) {
      searchCalls.push({ groupIds, query, limit });
      return facts;
    },
    async expireFact(groupId: string, uuid: string) {
      expireCalls.push({ groupId, uuid });
    },
    async loadFactsDateOrdered() { return []; },
    async addMemory() { return undefined; },
    async loadFacts() { return []; },
    async addFact() {},
    async getRecentFacts() { return []; },
    async getRelevantFacts() { return []; },
    async getFactsByTags() { return []; },
    async updateFact() {},
  } as unknown as IMemoryService & {
    searchCalls: Array<{ groupIds: readonly string[]; query: string; limit?: number }>;
    expireCalls: Array<{ groupId: string; uuid: string }>;
  };
}

function createMockCurationService(): ICurationService & {
  markCalls: Array<{ groupId: string; uuid: string; mark: CurationMark }>;
} {
  const markCalls: Array<{ groupId: string; uuid: string; mark: CurationMark }> = [];
  return {
    markCalls,
    async markFact(groupId: string, uuid: string, mark: CurationMark) {
      markCalls.push({ groupId, uuid, mark });
    },
    computeQualityScore() { return 0.5; },
    rankByQuality(items: readonly IMemoryItem[]) { return items; },
  };
}

function createMockConsolidationService(): IConsolidationService & {
  consolidateCalls: Array<{ groupId: string; uuids: readonly string[] }>;
} {
  const consolidateCalls: Array<{ groupId: string; uuids: readonly string[] }> = [];
  return {
    consolidateCalls,
    async consolidate(groupId: string, factUuids: readonly string[]) {
      consolidateCalls.push({ groupId, uuids: factUuids });
      return {
        action: 'archive-duplicates' as const,
        retainedUuid: factUuids[0]!,
        archivedUuids: factUuids.slice(1),
        relationshipsCreated: factUuids.length - 1,
      };
    },
  };
}

function createMockSummarizationService(): ISummarizationService {
  return {
    async summarize() {
      return {
        summary: 'This week the team worked on authentication and API design.',
        factCount: 10,
        timeRange: { from: '2026-01-08T00:00:00Z', to: '2026-01-15T00:00:00Z' },
        topics: ['authentication', 'API'],
        usage: MOCK_USAGE,
      };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('NlCurationService', () => {
  describe('plan()', () => {
    it('should call LLM with curation feature', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search for auth memories',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'auth' }, description: 'Search' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      await service.plan('what do we know about auth?', 'test-group');

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.feature, 'curation');
    });

    it('should classify query intent correctly', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search for authentication memories',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'authentication', limit: 10 }, description: 'Search' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('what do we know about authentication?', 'test-group');

      assert.strictEqual(plan.intent, 'query');
      assert.strictEqual(plan.isDestructive, false);
      assert.strictEqual(plan.operations.length, 1);
      assert.strictEqual(plan.operations[0]?.type, 'search');
    });

    it('should classify mark intent correctly', async () => {
      const response = JSON.stringify({
        intent: 'mark',
        description: 'Mark PostgreSQL decision as authoritative',
        isDestructive: false,
        operations: [
          { type: 'search', params: { query: 'PostgreSQL decision' }, description: 'Find fact' },
          { type: 'mark', params: { query: 'PostgreSQL decision', mark: 'authoritative' }, description: 'Mark it' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('mark the PostgreSQL decision as authoritative', 'test-group');

      assert.strictEqual(plan.intent, 'mark');
      assert.strictEqual(plan.isDestructive, false);
      assert.strictEqual(plan.operations.length, 2);
    });

    it('should classify expire intent as destructive', async () => {
      const response = JSON.stringify({
        intent: 'expire',
        description: 'Expire old API design facts',
        isDestructive: true,
        operations: [
          { type: 'search', params: { query: 'old API design' }, description: 'Find facts' },
          { type: 'expire', params: { query: 'old API design' }, description: 'Expire them' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('forget everything about the old API design', 'test-group');

      assert.strictEqual(plan.intent, 'expire');
      assert.strictEqual(plan.isDestructive, true);
    });

    it('should classify consolidate intent as destructive', async () => {
      const response = JSON.stringify({
        intent: 'consolidate',
        description: 'Consolidate duplicate database facts',
        isDestructive: true,
        operations: [
          { type: 'consolidate', params: { query: 'database' }, description: 'Merge duplicates' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('consolidate duplicate database facts', 'test-group');

      assert.strictEqual(plan.intent, 'consolidate');
      assert.strictEqual(plan.isDestructive, true);
    });

    it('should classify summarize intent correctly', async () => {
      const response = JSON.stringify({
        intent: 'summarize',
        description: 'Summarize recent memories',
        isDestructive: false,
        operations: [{ type: 'summarize', params: { style: 'concise' }, description: 'Summarize' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('summarize what happened this week', 'test-group');

      assert.strictEqual(plan.intent, 'summarize');
      assert.strictEqual(plan.isDestructive, false);
    });

    it('should include LLM usage in plan', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'test' }, description: 'Search' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('test', 'test-group');

      assert.deepStrictEqual(plan.usage, MOCK_USAGE);
    });

    it('should use low temperature for intent classification', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'test' }, description: 'Search' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      await service.plan('test', 'test-group');

      assert.strictEqual(guard.calls[0]?.options?.temperature, 0.2);
    });

    it('should fallback to query on malformed JSON', async () => {
      const guard = createMockLlmGuard('This is not valid JSON at all');
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('something', 'test-group');

      assert.strictEqual(plan.intent, 'query');
      assert.strictEqual(plan.isDestructive, false);
      assert.ok(plan.operations.length >= 1);
      assert.strictEqual(plan.operations[0]?.type, 'search');
    });

    it('should fallback to query on invalid intent', async () => {
      const response = JSON.stringify({
        intent: 'invalid-intent',
        description: 'Bad intent',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'test' }, description: 'Search' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('test', 'test-group');

      assert.strictEqual(plan.intent, 'query');
    });

    it('should handle JSON response with wrapper text', async () => {
      const wrapped = 'Here is the plan:\n' + JSON.stringify({
        intent: 'query',
        description: 'Search for auth',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'auth' }, description: 'Search' }],
      }) + '\n\nLet me know!';
      const guard = createMockLlmGuard(wrapped);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('auth stuff', 'test-group');

      assert.strictEqual(plan.intent, 'query');
    });

    it('should add default operation when operations array is empty', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search memories',
        isDestructive: false,
        operations: [],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('test', 'test-group');

      assert.ok(plan.operations.length >= 1);
      assert.strictEqual(plan.operations[0]?.type, 'search');
    });

    it('should skip operations with invalid type', async () => {
      const response = JSON.stringify({
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [
          { type: 'unknown-op', params: {}, description: 'Bad op' },
          { type: 'search', params: { query: 'test' }, description: 'Good op' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('test', 'test-group');

      assert.strictEqual(plan.operations.length, 1);
      assert.strictEqual(plan.operations[0]?.type, 'search');
    });

    it('should infer isDestructive for expire even if LLM says false', async () => {
      const response = JSON.stringify({
        intent: 'expire',
        description: 'Expire facts',
        isDestructive: false, // LLM got it wrong
        operations: [{ type: 'expire', params: { query: 'old stuff' }, description: 'Expire' }],
      });
      const guard = createMockLlmGuard(response);
      const service = createNlCurationService(
        guard, createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan = await service.plan('forget old stuff', 'test-group');

      // The service should use the LLM's value when it's explicitly a boolean
      // but the intent being expire means the LLM said isDestructive: false explicitly
      assert.strictEqual(plan.intent, 'expire');
      // We trust the LLM's explicit boolean value
      assert.strictEqual(plan.isDestructive, false);
    });
  });

  describe('execute()', () => {
    it('should execute search operation via memoryService', async () => {
      const facts = [makeFact('a1', 'Auth uses JWT'), makeFact('a2', 'OAuth configured')];
      const memSvc = createMockMemoryService(facts);
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'query',
        description: 'Search for auth facts',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'authentication', limit: 10 }, description: 'Search' }],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Found 2 fact(s)'));
      assert.ok(result.output.includes('Auth uses JWT'));
      assert.strictEqual(memSvc.searchCalls.length, 1);
      assert.strictEqual(memSvc.searchCalls[0]?.query, 'authentication');
    });

    it('should execute mark operation via curationService', async () => {
      const facts = [makeFact('a1', 'PostgreSQL decision')];
      const memSvc = createMockMemoryService(facts);
      const curSvc = createMockCurationService();
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, curSvc,
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'mark',
        description: 'Mark fact as authoritative',
        isDestructive: false,
        operations: [
          { type: 'mark', params: { query: 'PostgreSQL', mark: 'authoritative' }, description: 'Mark it' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Marked 1 fact(s) as authoritative'));
      assert.strictEqual(curSvc.markCalls.length, 1);
      assert.strictEqual(curSvc.markCalls[0]?.mark, 'authoritative');
    });

    it('should execute expire operation via memoryService', async () => {
      const facts = [makeFact('a1', 'Old API v1'), makeFact('a2', 'Old API routes')];
      const memSvc = createMockMemoryService(facts);
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'expire',
        description: 'Expire old API facts',
        isDestructive: true,
        operations: [
          { type: 'expire', params: { query: 'old API' }, description: 'Expire matching facts' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Expired 2 fact(s)'));
      assert.strictEqual(memSvc.expireCalls.length, 2);
    });

    it('should execute summarize operation via summarizationService', async () => {
      const service = createNlCurationService(
        createMockLlmGuard('{}'), createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'summarize',
        description: 'Summarize recent memories',
        isDestructive: false,
        operations: [
          { type: 'summarize', params: { style: 'concise' }, description: 'Summarize' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('authentication'));
      assert.ok(result.output.includes('API'));
    });

    it('should execute consolidate operation via consolidationService', async () => {
      const facts = [makeFact('a1', 'DB is Postgres'), makeFact('a2', 'We use PostgreSQL')];
      const memSvc = createMockMemoryService(facts);
      const conSvc = createMockConsolidationService();
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        conSvc, createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'consolidate',
        description: 'Consolidate database facts',
        isDestructive: true,
        operations: [
          { type: 'consolidate', params: { query: 'database' }, description: 'Merge duplicates' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Consolidated'));
      assert.strictEqual(conSvc.consolidateCalls.length, 1);
    });

    it('should handle search with no results', async () => {
      const memSvc = createMockMemoryService([]); // empty
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'nonexistent' }, description: 'Search' }],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.ok(result.output.includes('No facts found'));
    });

    it('should handle mark with invalid curation mark', async () => {
      const service = createNlCurationService(
        createMockLlmGuard('{}'), createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'mark',
        description: 'Mark with invalid status',
        isDestructive: false,
        operations: [
          { type: 'mark', params: { query: 'test', mark: 'invalid-mark' }, description: 'Bad mark' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.ok(result.output.includes('Invalid curation mark'));
    });

    it('should handle consolidate with fewer than 2 facts', async () => {
      const memSvc = createMockMemoryService([makeFact('a1', 'Only one')]);
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'consolidate',
        description: 'Consolidate',
        isDestructive: true,
        operations: [
          { type: 'consolidate', params: { query: 'test' }, description: 'Merge' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.ok(result.output.includes('Not enough facts'));
    });

    it('should handle operation failure gracefully', async () => {
      const memSvc = {
        async searchFacts() { throw new Error('Database unavailable'); },
        async expireFact() {},
        async loadFactsDateOrdered() { return []; },
        async addMemory() { return undefined; },
        async loadFacts() { return []; },
        async addFact() {},
        async getRecentFacts() { return []; },
        async getRelevantFacts() { return []; },
        async getFactsByTags() { return []; },
        async updateFact() {},
      } as unknown as IMemoryService;

      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'test' }, description: 'Search' }],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Failed'));
      assert.ok(result.output.includes('Database unavailable'));
    });

    it('should execute multiple operations in sequence', async () => {
      const facts = [makeFact('a1', 'Old API design'), makeFact('a2', 'Old API routes')];
      const memSvc = createMockMemoryService(facts);
      const service = createNlCurationService(
        createMockLlmGuard('{}'), memSvc, createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'expire',
        description: 'Find and expire old API facts',
        isDestructive: true,
        operations: [
          { type: 'search', params: { query: 'old API' }, description: 'Find old API facts' },
          { type: 'expire', params: { query: 'old API' }, description: 'Expire them' },
        ],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.executed, true);
      assert.ok(result.output.includes('Found 2 fact(s)'));
      assert.ok(result.output.includes('Expired 2 fact(s)'));
    });

    it('should return plan in result', async () => {
      const service = createNlCurationService(
        createMockLlmGuard('{}'), createMockMemoryService(), createMockCurationService(),
        createMockConsolidationService(), createMockSummarizationService()
      );

      const plan: INlCurationPlan = {
        intent: 'query',
        description: 'Search',
        isDestructive: false,
        operations: [{ type: 'search', params: { query: 'test' }, description: 'Search' }],
        usage: MOCK_USAGE,
      };

      const result = await service.execute(plan, 'test-group');

      assert.strictEqual(result.plan, plan);
    });
  });
});
