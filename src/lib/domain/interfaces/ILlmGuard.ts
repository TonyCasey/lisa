/**
 * LLM Guard Interface.
 *
 * Policy decorator over ILlmService that enforces budget limits,
 * per-feature toggles, and usage tracking. All LLM consumers
 * should go through the guard rather than calling ILlmService directly.
 *
 * Part of Phase 6B: Cost/Privacy Controls.
 */

import type { ILlmResponse, ILlmRequestOptions } from './ILlmService';
import type { LlmFeature } from './ILlmUsageTracker';

/**
 * Guarded LLM completion service.
 * Enforces budget, feature toggles, and records usage.
 */
export interface ILlmGuard {
  /**
   * Send a completion request with policy enforcement.
   *
   * @param prompt - The user prompt text
   * @param feature - Which LLM feature is making the request
   * @param options - Optional request overrides
   * @throws LlmFeatureDisabledError if the feature is toggled off
   * @throws LlmBudgetExceededError if over the monthly budget
   * @throws LlmDisabledError if LLM is disabled globally
   * @throws LlmProviderError if the provider returns an error
   */
  complete(
    prompt: string,
    feature: LlmFeature,
    options?: ILlmRequestOptions
  ): Promise<ILlmResponse>;

  /**
   * Check whether a specific LLM feature is enabled.
   * Checks both the master switch and per-feature toggles.
   */
  isFeatureEnabled(feature: LlmFeature): Promise<boolean>;
}
