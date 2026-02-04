/**
 * LlmGuard Tests.
 *
 * Tests policy enforcement: feature toggles, budget limits,
 * usage recording, and delegation to underlying LlmService.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createLlmGuard } from '../../../../../../src/lib/infrastructure/services/LlmGuard';
import type { ILlmService, ILlmResponse, ILlmConfig, ILlmRequestOptions } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import { getDefaultLlmConfig } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { ILlmConfigService } from '../../../../../../src/lib/domain/interfaces/ILlmConfigService';
import type { ILlmUsageTracker, ILlmUsageRecord } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';
import type { IPreferenceStore } from '../../../../../../src/lib/domain/interfaces/IPreferenceStore';
import { LlmFeatureDisabledError, LlmBudgetExceededError } from '../../../../../../src/lib/domain/errors/LlmErrors';

// ── Mock LLM service ───────────────────────────────────────

function createMockLlmService(): ILlmService & { calls: string[] } {
  const calls: string[] = [];
  const mockResponse: ILlmResponse = {
    text: 'Mock response',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
  };

  return {
    calls,
    async complete(prompt: string) {
      calls.push(prompt);
      return mockResponse;
    },
    async isAvailable() { return true; },
    async getConfig() { return getDefaultLlmConfig(); },
  };
}

// ── Mock usage tracker ─────────────────────────────────────

function createMockUsageTracker(overrides: { withinBudget?: boolean; totalCost?: number } = {}): ILlmUsageTracker & { recorded: Array<Omit<ILlmUsageRecord, 'timestamp'>> } {
  const recorded: Array<Omit<ILlmUsageRecord, 'timestamp'>> = [];
  return {
    recorded,
    async record(usage) { recorded.push(usage); },
    async getUsage() { return []; },
    async getTotalCost() { return overrides.totalCost ?? 0; },
    async isWithinBudget() { return overrides.withinBudget ?? true; },
  };
}

// ── Mock config service ────────────────────────────────────

function createMockConfigService(overrides: Partial<ILlmConfig> = {}): ILlmConfigService {
  const config: ILlmConfig = {
    ...getDefaultLlmConfig(),
    enabled: true,
    ...overrides,
  };
  return {
    async getConfig() { return config; },
    async setProvider() { /* no-op */ },
    async setModel() { /* no-op */ },
    async setEndpoint() { /* no-op */ },
    async setApiKey() { /* no-op */ },
    async setEnabled() { /* no-op */ },
    async setMaxTokens() { /* no-op */ },
    async setTemperature() { /* no-op */ },
    async reset() { /* no-op */ },
  };
}

// ── Mock preference store ──────────────────────────────────

function createMockPreferenceStore(prefs: Record<string, string> = {}): IPreferenceStore {
  const store = new Map<string, string>(Object.entries(prefs));
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { return store.delete(key); },
    async list() { return []; },
    async has(key: string) { return store.has(key); },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('LlmGuard', () => {
  describe('complete()', () => {
    it('should delegate to LlmService when enabled and within budget', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      const response = await guard.complete('Test prompt', 'test');

      assert.strictEqual(response.text, 'Mock response');
      assert.strictEqual(llmSvc.calls.length, 1);
      assert.strictEqual(llmSvc.calls[0], 'Test prompt');
    });

    it('should record usage after successful call', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      await guard.complete('Test prompt', 'summarization');

      assert.strictEqual(tracker.recorded.length, 1);
      assert.strictEqual(tracker.recorded[0]?.feature, 'summarization');
      assert.strictEqual(tracker.recorded[0]?.provider, 'anthropic');
      assert.strictEqual(tracker.recorded[0]?.inputTokens, 10);
      assert.strictEqual(tracker.recorded[0]?.outputTokens, 5);
      assert.ok(typeof tracker.recorded[0]?.estimatedCostUsd === 'number');
    });

    it('should throw LlmFeatureDisabledError when feature is disabled', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:features': 'summarization,extraction' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);

      await assert.rejects(
        async () => guard.complete('Test', 'deduplication'),
        (error: unknown) => {
          assert.ok(error instanceof LlmFeatureDisabledError);
          assert.strictEqual(error.name, 'LlmFeatureDisabledError');
          assert.strictEqual(error.feature, 'deduplication');
          return true;
        }
      );
    });

    it('should throw LlmFeatureDisabledError when master switch is off', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: false });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);

      await assert.rejects(
        async () => guard.complete('Test', 'test'),
        (error: unknown) => {
          assert.ok(error instanceof LlmFeatureDisabledError);
          assert.strictEqual(error.name, 'LlmFeatureDisabledError');
          return true;
        }
      );
    });

    it('should throw LlmBudgetExceededError when over budget', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker({ withinBudget: false, totalCost: 15.50 });
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:monthlyLimit': '10.00' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);

      await assert.rejects(
        async () => guard.complete('Test', 'test'),
        (error: unknown) => {
          assert.ok(error instanceof LlmBudgetExceededError);
          assert.strictEqual(error.name, 'LlmBudgetExceededError');
          assert.strictEqual(error.currentCost, 15.50);
          assert.strictEqual(error.budgetLimit, 10.00);
          return true;
        }
      );

      // Should not have called the LLM
      assert.strictEqual(llmSvc.calls.length, 0);
    });

    it('should pass options through to LlmService', async () => {
      let capturedOptions: ILlmRequestOptions | undefined;
      const llmSvc: ILlmService = {
        async complete(_prompt, options) {
          capturedOptions = options;
          return {
            text: 'Response',
            usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
            model: 'claude-sonnet-4-20250514',
            provider: 'anthropic',
          };
        },
        async isAvailable() { return true; },
        async getConfig() { return getDefaultLlmConfig(); },
      };
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      await guard.complete('Test', 'test', {
        maxTokens: 2048,
        temperature: 0.5,
        systemPrompt: 'You are helpful.',
      });

      assert.ok(capturedOptions, 'capturedOptions should be defined');
      assert.strictEqual(capturedOptions.maxTokens, 2048);
      assert.strictEqual(capturedOptions.temperature, 0.5);
      assert.strictEqual(capturedOptions.systemPrompt, 'You are helpful.');
    });

    it('should include cost estimate in recorded usage', async () => {
      const llmSvc: ILlmService = {
        async complete() {
          return {
            text: 'Response',
            usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
            model: 'claude-sonnet-4-20250514',
            provider: 'anthropic',
          };
        },
        async isAvailable() { return true; },
        async getConfig() { return getDefaultLlmConfig(); },
      };
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      await guard.complete('Test', 'test');

      assert.strictEqual(tracker.recorded.length, 1);
      assert.ok(tracker.recorded[0]!.estimatedCostUsd > 0);
    });
  });

  describe('isFeatureEnabled()', () => {
    it('should return false when master switch is off', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: false });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      const result = await guard.isFeatureEnabled('test');
      assert.strictEqual(result, false);
    });

    it('should return true when master switch on and no feature filter', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore();

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      const result = await guard.isFeatureEnabled('summarization');
      assert.strictEqual(result, true);
    });

    it('should return true when feature is in the enabled list', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:features': 'summarization,test' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      assert.strictEqual(await guard.isFeatureEnabled('summarization'), true);
      assert.strictEqual(await guard.isFeatureEnabled('test'), true);
    });

    it('should return false when feature is not in the enabled list', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:features': 'summarization' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      assert.strictEqual(await guard.isFeatureEnabled('deduplication'), false);
    });

    it('should treat wildcard * as all enabled', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:features': '*' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      assert.strictEqual(await guard.isFeatureEnabled('deduplication'), true);
    });

    it('should treat empty string as all enabled', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      const prefs = createMockPreferenceStore({ 'llm:features': '' });

      const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
      assert.strictEqual(await guard.isFeatureEnabled('curation'), true);
    });

    it('should use env var over preference store when set', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      // Preference store says only summarization enabled
      const prefs = createMockPreferenceStore({ 'llm:features': 'summarization' });

      // But env var enables extraction
      const originalEnv = process.env.LISA_LLM_FEATURES;
      process.env.LISA_LLM_FEATURES = 'extraction';

      try {
        const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
        // Env var wins: extraction enabled, summarization disabled
        assert.strictEqual(await guard.isFeatureEnabled('extraction'), true);
        assert.strictEqual(await guard.isFeatureEnabled('summarization'), false);
      } finally {
        // Restore original env
        if (originalEnv === undefined) {
          delete process.env.LISA_LLM_FEATURES;
        } else {
          process.env.LISA_LLM_FEATURES = originalEnv;
        }
      }
    });

    it('should use env var wildcard to enable all features', async () => {
      const llmSvc = createMockLlmService();
      const tracker = createMockUsageTracker();
      const configSvc = createMockConfigService({ enabled: true });
      // Preference store restricts to summarization only
      const prefs = createMockPreferenceStore({ 'llm:features': 'summarization' });

      const originalEnv = process.env.LISA_LLM_FEATURES;
      process.env.LISA_LLM_FEATURES = '*';

      try {
        const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
        // Env var wildcard enables all
        assert.strictEqual(await guard.isFeatureEnabled('extraction'), true);
        assert.strictEqual(await guard.isFeatureEnabled('deduplication'), true);
        assert.strictEqual(await guard.isFeatureEnabled('curation'), true);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.LISA_LLM_FEATURES;
        } else {
          process.env.LISA_LLM_FEATURES = originalEnv;
        }
      }
    });
  });

  describe('budget env var precedence', () => {
    it('should enforce budget using env var limit when set', async () => {
      const llmSvc = createMockLlmService();
      // Current cost is 15.50
      const tracker = createMockUsageTracker({ withinBudget: true, totalCost: 15.50 });
      const configSvc = createMockConfigService({ enabled: true });
      // Preference store has no limit (would allow)
      const prefs = createMockPreferenceStore();

      // Env var sets limit to 10.00 - should block since cost (15.50) >= limit (10.00)
      const originalEnv = process.env.LISA_LLM_MONTHLY_LIMIT;
      process.env.LISA_LLM_MONTHLY_LIMIT = '10.00';

      try {
        const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);

        await assert.rejects(
          async () => guard.complete('Test', 'test'),
          (error: unknown) => {
            assert.ok(error instanceof LlmBudgetExceededError);
            assert.strictEqual(error.budgetLimit, 10.00);
            assert.strictEqual(error.currentCost, 15.50);
            return true;
          }
        );
      } finally {
        if (originalEnv === undefined) {
          delete process.env.LISA_LLM_MONTHLY_LIMIT;
        } else {
          process.env.LISA_LLM_MONTHLY_LIMIT = originalEnv;
        }
      }
    });

    it('should allow when cost is under env var limit', async () => {
      const llmSvc = createMockLlmService();
      // Current cost is 5.00
      const tracker = createMockUsageTracker({ withinBudget: false, totalCost: 5.00 });
      const configSvc = createMockConfigService({ enabled: true });
      // Preference store says over budget (limit 2.00) - but env var should override
      const prefs = createMockPreferenceStore({ 'llm:monthlyLimit': '2.00' });

      // Env var sets higher limit of 10.00 - should allow since cost (5.00) < limit (10.00)
      const originalEnv = process.env.LISA_LLM_MONTHLY_LIMIT;
      process.env.LISA_LLM_MONTHLY_LIMIT = '10.00';

      try {
        const guard = createLlmGuard(llmSvc, tracker, configSvc, prefs);
        // Should succeed - env var limit (10.00) > cost (5.00)
        const response = await guard.complete('Test', 'test');
        assert.strictEqual(response.text, 'Mock response');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.LISA_LLM_MONTHLY_LIMIT;
        } else {
          process.env.LISA_LLM_MONTHLY_LIMIT = originalEnv;
        }
      }
    });
  });
});
