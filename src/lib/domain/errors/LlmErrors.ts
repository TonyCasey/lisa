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
