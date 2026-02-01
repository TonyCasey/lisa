/**
 * LLM-specific error classes.
 *
 * Part of Phase 6A: LLM Provider Abstraction Layer.
 */

import { LisaError } from './LisaError';

/**
 * Error thrown when LLM is disabled but an LLM operation is requested.
 */
export class LlmDisabledError extends LisaError {
  constructor(message?: string) {
    super(
      message || 'LLM features are disabled. Enable with: lisa llm config --enable',
      'LLM_DISABLED'
    );
    this.name = 'LlmDisabledError';
  }
}

/**
 * Error thrown when the LLM provider returns an error.
 */
export class LlmProviderError extends LisaError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    data?: Record<string, unknown>
  ) {
    super(message, 'LLM_PROVIDER_ERROR', { ...data, statusCode });
    this.name = 'LlmProviderError';
  }
}

/**
 * Error thrown for invalid LLM configuration.
 */
export class LlmConfigError extends LisaError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(message, 'LLM_CONFIG_ERROR', data);
    this.name = 'LlmConfigError';
  }
}

/**
 * Error thrown when a specific LLM feature is disabled.
 */
export class LlmFeatureDisabledError extends LisaError {
  constructor(
    public readonly feature: string,
    data?: Record<string, unknown>
  ) {
    super(
      `LLM feature '${feature}' is disabled. Enable with: lisa llm features --enable ${feature}`,
      'LLM_FEATURE_DISABLED',
      { ...data, feature }
    );
    this.name = 'LlmFeatureDisabledError';
  }
}

/**
 * Error thrown when the monthly LLM budget has been exceeded.
 */
export class LlmBudgetExceededError extends LisaError {
  constructor(
    public readonly currentCost: number,
    public readonly budgetLimit: number,
    data?: Record<string, unknown>
  ) {
    super(
      `Monthly LLM budget exceeded: $${currentCost.toFixed(4)} / $${budgetLimit.toFixed(2)} limit`,
      'LLM_BUDGET_EXCEEDED',
      { ...data, currentCost, budgetLimit }
    );
    this.name = 'LlmBudgetExceededError';
  }
}
