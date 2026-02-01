/**
 * LLM Service Interfaces.
 *
 * Domain contracts for interacting with Large Language Model providers.
 * Supports multiple backends: Anthropic (Claude), OpenAI, and Ollama (local).
 *
 * Part of Phase 6A: LLM Provider Abstraction Layer.
 */

/**
 * Supported LLM providers.
 */
export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

/**
 * All valid LLM provider values.
 */
export const LLM_PROVIDER_VALUES: readonly LlmProvider[] = [
  'anthropic',
  'openai',
  'ollama',
] as const;

/**
 * Type guard for LlmProvider.
 */
export function isValidLlmProvider(value: string): value is LlmProvider {
  return LLM_PROVIDER_VALUES.includes(value as LlmProvider);
}

/**
 * LLM configuration.
 */
export interface ILlmConfig {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly enabled: boolean;
  readonly maxTokens: number;
  readonly temperature: number;
}

/**
 * Default LLM configuration.
 */
export function getDefaultLlmConfig(): ILlmConfig {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    enabled: false,
    maxTokens: 1024,
    temperature: 0.3,
  };
}

/**
 * Token usage from an LLM call.
 */
export interface ILlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

/**
 * Response from an LLM call.
 */
export interface ILlmResponse {
  readonly text: string;
  readonly usage: ILlmUsage;
  readonly model: string;
  readonly provider: LlmProvider;
}

/**
 * Options for an LLM completion request.
 */
export interface ILlmRequestOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
}

/**
 * LLM completion service.
 * Sends prompts to an LLM provider and returns structured responses.
 */
export interface ILlmService {
  /**
   * Send a completion request to the configured LLM provider.
   *
   * @param prompt - The user prompt text
   * @param options - Optional request overrides (tokens, temperature, system prompt)
   * @throws LlmDisabledError if LLM is disabled
   * @throws LlmConfigError if configuration is invalid (e.g. missing API key)
   * @throws LlmProviderError if the provider returns an error
   */
  complete(prompt: string, options?: ILlmRequestOptions): Promise<ILlmResponse>;

  /**
   * Check whether the LLM provider is available and configured.
   * Returns false if disabled or provider unreachable.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the current resolved LLM configuration.
   */
  getConfig(): Promise<ILlmConfig>;
}
