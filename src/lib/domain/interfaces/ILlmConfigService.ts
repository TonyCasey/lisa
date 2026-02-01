/**
 * LLM Configuration Service Interface.
 *
 * Domain contract for managing LLM provider configuration.
 * Configuration is persisted via PreferenceStore with env var overrides.
 *
 * Part of Phase 6A: LLM Provider Abstraction Layer.
 */

import type { LlmProvider, ILlmConfig } from './ILlmService';

/**
 * Service for reading and writing LLM configuration.
 */
export interface ILlmConfigService {
  /**
   * Get the resolved LLM configuration.
   * Merge order: defaults <- preferences <- environment variables.
   */
  getConfig(): Promise<ILlmConfig>;

  /** Set the LLM provider. */
  setProvider(provider: LlmProvider): Promise<void>;

  /** Set the model name. */
  setModel(model: string): Promise<void>;

  /** Set a custom endpoint URL. */
  setEndpoint(endpoint: string): Promise<void>;

  /** Set the API key. */
  setApiKey(apiKey: string): Promise<void>;

  /** Enable or disable LLM features. */
  setEnabled(enabled: boolean): Promise<void>;

  /** Set the default max output tokens. */
  setMaxTokens(maxTokens: number): Promise<void>;

  /** Set the default temperature. */
  setTemperature(temperature: number): Promise<void>;

  /** Reset all LLM configuration to defaults (clears stored preferences). */
  reset(): Promise<void>;
}
