/**
 * LLM Guard Implementation.
 *
 * Policy decorator over ILlmService. Enforces:
 * - Per-feature enable/disable toggles
 * - Monthly budget limits
 * - Usage recording after each call
 *
 * All LLM consumers should use ILlmGuard instead of ILlmService directly.
 *
 * Part of Phase 6B: Cost/Privacy Controls.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ILlmService, ILlmResponse, ILlmRequestOptions } from '../../domain/interfaces/ILlmService';
import type { ILlmConfigService } from '../../domain/interfaces/ILlmConfigService';
import type { ILlmUsageTracker, LlmFeature } from '../../domain/interfaces/ILlmUsageTracker';
import type { IPreferenceStore } from '../../domain/interfaces/IPreferenceStore';
import type { ILogger } from '../../domain/interfaces/ILogger';
import { LlmFeatureDisabledError, LlmBudgetExceededError } from '../../domain/errors/LlmErrors';
import { estimateCost } from './LlmUsageTracker';

/** Preference key for enabled features (comma-separated). */
const FEATURES_PREF_KEY = 'llm:features';

/** Preference key for monthly budget limit. */
const BUDGET_PREF_KEY = 'llm:monthlyLimit';

/** Environment variable for enabled features (takes precedence over preferences). */
const FEATURES_ENV_KEY = 'LISA_LLM_FEATURES';

/** Environment variable for monthly budget limit (takes precedence over preferences). */
const BUDGET_ENV_KEY = 'LISA_LLM_MONTHLY_LIMIT';

/**
 * Parse the enabled features from the preference value.
 * Returns null if all features should be enabled (default).
 */
function parseEnabledFeatures(value: string | null): Set<string> | null {
  if (value === null || value.trim() === '' || value.trim() === '*') {
    return null; // All features enabled
  }
  return new Set(value.split(',').map(f => f.trim()).filter(f => f.length > 0));
}

/**
 * Create an LLM guard service.
 *
 * @param llmService - Underlying LLM service for completion calls
 * @param usageTracker - Usage tracker for recording and budget checks
 * @param configService - Config service for checking master switch
 * @param preferenceStore - Preference store for per-feature toggles
 * @param logger - Optional logger
 */
export function createLlmGuard(
  llmService: ILlmService,
  usageTracker: ILlmUsageTracker,
  configService: ILlmConfigService,
  preferenceStore: IPreferenceStore,
  logger?: ILogger
): ILlmGuard {
  return {
    async complete(
      prompt: string,
      feature: LlmFeature,
      options?: ILlmRequestOptions
    ): Promise<ILlmResponse> {
      // Check feature toggle
      const enabled = await this.isFeatureEnabled(feature);
      if (!enabled) {
        throw new LlmFeatureDisabledError(feature);
      }

      // Check budget
      const withinBudget = await usageTracker.isWithinBudget();
      if (!withinBudget) {
        const cost = await usageTracker.getTotalCost();
        // Check env var first, then preference store
        const envLimit = process.env[BUDGET_ENV_KEY];
        const prefLimit = await preferenceStore.get(BUDGET_PREF_KEY);
        const limitStr = envLimit ?? prefLimit;
        const limit = limitStr !== null ? parseFloat(limitStr) : 0;
        throw new LlmBudgetExceededError(cost, limit, { feature });
      }

      // Delegate to underlying service
      const response = await llmService.complete(prompt, options);

      // Record usage
      const cost = estimateCost(
        response.provider,
        response.usage.inputTokens,
        response.usage.outputTokens
      );

      await usageTracker.record({
        provider: response.provider,
        model: response.model,
        feature,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        estimatedCostUsd: cost,
      });

      logger?.debug('LLM guard: call completed', {
        feature,
        provider: response.provider,
        model: response.model,
        cost: cost.toFixed(6),
      });

      return response;
    },

    async isFeatureEnabled(feature: LlmFeature): Promise<boolean> {
      // Check master switch
      const config = await configService.getConfig();
      if (!config.enabled) return false;

      // Check env var first (takes precedence over preferences)
      const envValue = process.env[FEATURES_ENV_KEY];
      if (envValue !== undefined) {
        const enabledFromEnv = parseEnabledFeatures(envValue);
        // null means all features enabled
        if (enabledFromEnv === null) return true;
        return enabledFromEnv.has(feature);
      }

      // Fall back to preference store
      const prefValue = await preferenceStore.get(FEATURES_PREF_KEY);
      const enabledFeatures = parseEnabledFeatures(prefValue);

      // null means all features enabled (default)
      if (enabledFeatures === null) return true;

      return enabledFeatures.has(feature);
    },
  };
}
