/**
 * LLM Configuration Service Implementation.
 *
 * Reads/writes LLM configuration from PreferenceStore with `llm:*` keys.
 * Environment variables take precedence over stored preferences.
 *
 * Merge order: defaults <- preferences <- environment variables.
 *
 * Part of Phase 6A: LLM Provider Abstraction Layer.
 */

import type { ILlmConfigService } from '../../domain/interfaces/ILlmConfigService';
import type { IPreferenceStore } from '../../domain/interfaces/IPreferenceStore';
import type { LlmProvider, ILlmConfig } from '../../domain/interfaces/ILlmService';
import { getDefaultLlmConfig, isValidLlmProvider } from '../../domain/interfaces/ILlmService';
import { LlmConfigError } from '../../domain/errors/LlmErrors';

/** Mutable version of ILlmConfig for internal config building. */
type MutableLlmConfig = {
  -readonly [K in keyof ILlmConfig]: ILlmConfig[K];
};

/** Preference keys for LLM configuration. */
const PREF_KEYS = {
  provider: 'llm:provider',
  model: 'llm:model',
  endpoint: 'llm:endpoint',
  apiKey: 'llm:apiKey',
  enabled: 'llm:enabled',
  maxTokens: 'llm:maxTokens',
  temperature: 'llm:temperature',
} as const;

/** Environment variable names for LLM configuration. */
const ENV_VARS = {
  provider: 'LISA_LLM_PROVIDER',
  model: 'LISA_LLM_MODEL',
  endpoint: 'LISA_LLM_ENDPOINT',
  apiKey: 'LISA_LLM_API_KEY',
  enabled: 'LISA_LLM_ENABLED',
} as const;

/** All llm:* preference keys. */
const ALL_PREF_KEYS = Object.values(PREF_KEYS);

/**
 * Create an LLM configuration service.
 *
 * @param preferenceStore - Preference store for persisting config
 */
export function createLlmConfigService(
  preferenceStore: IPreferenceStore
): ILlmConfigService {
  /**
   * Resolve the API key from env vars with provider-specific fallbacks.
   */
  function resolveApiKeyFromEnv(provider: LlmProvider): string | undefined {
    // Direct env var takes top priority
    const direct = process.env[ENV_VARS.apiKey];
    if (direct) return direct;

    // Provider-specific fallbacks
    if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
    if (provider === 'openai') return process.env.OPENAI_API_KEY;
    return undefined;
  }

  return {
    async getConfig(): Promise<ILlmConfig> {
      const defaults = getDefaultLlmConfig();

      // Read preferences
      const prefProvider = await preferenceStore.get(PREF_KEYS.provider);
      const prefModel = await preferenceStore.get(PREF_KEYS.model);
      const prefEndpoint = await preferenceStore.get(PREF_KEYS.endpoint);
      const prefApiKey = await preferenceStore.get(PREF_KEYS.apiKey);
      const prefEnabled = await preferenceStore.get(PREF_KEYS.enabled);
      const prefMaxTokens = await preferenceStore.get(PREF_KEYS.maxTokens);
      const prefTemperature = await preferenceStore.get(PREF_KEYS.temperature);

      // Build config from preferences
      const fromPrefs: Partial<MutableLlmConfig> = {};

      if (prefProvider !== null) {
        if (isValidLlmProvider(prefProvider)) {
          fromPrefs.provider = prefProvider;
        }
      }
      if (prefModel !== null) fromPrefs.model = prefModel;
      if (prefEndpoint !== null) fromPrefs.endpoint = prefEndpoint;
      if (prefApiKey !== null) fromPrefs.apiKey = prefApiKey;
      if (prefEnabled !== null) fromPrefs.enabled = prefEnabled === 'true';
      if (prefMaxTokens !== null) {
        const parsed = parseInt(prefMaxTokens, 10);
        if (!isNaN(parsed) && parsed > 0) fromPrefs.maxTokens = parsed;
      }
      if (prefTemperature !== null) {
        const parsed = parseFloat(prefTemperature);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) fromPrefs.temperature = parsed;
      }

      // Merge defaults <- prefs
      const merged: MutableLlmConfig = { ...defaults, ...fromPrefs };

      // Apply environment variable overrides
      const envProvider = process.env[ENV_VARS.provider];
      if (envProvider && isValidLlmProvider(envProvider)) {
        merged.provider = envProvider;
      }

      const envModel = process.env[ENV_VARS.model];
      if (envModel) merged.model = envModel;

      const envEndpoint = process.env[ENV_VARS.endpoint];
      if (envEndpoint) merged.endpoint = envEndpoint;

      const envEnabled = process.env[ENV_VARS.enabled];
      if (envEnabled !== undefined) merged.enabled = envEnabled === 'true';

      // API key: env vars (with provider-specific fallback)
      const envApiKey = resolveApiKeyFromEnv(merged.provider);
      if (envApiKey) merged.apiKey = envApiKey;

      return merged as ILlmConfig;
    },

    async setProvider(provider: LlmProvider): Promise<void> {
      if (!isValidLlmProvider(provider)) {
        throw new LlmConfigError(`Invalid LLM provider: ${provider}`, { provider });
      }
      await preferenceStore.set(PREF_KEYS.provider, provider);
    },

    async setModel(model: string): Promise<void> {
      if (!model.trim()) {
        throw new LlmConfigError('Model name cannot be empty');
      }
      await preferenceStore.set(PREF_KEYS.model, model.trim());
    },

    async setEndpoint(endpoint: string): Promise<void> {
      if (!endpoint.trim()) {
        throw new LlmConfigError('Endpoint cannot be empty');
      }
      await preferenceStore.set(PREF_KEYS.endpoint, endpoint.trim());
    },

    async setApiKey(apiKey: string): Promise<void> {
      if (!apiKey.trim()) {
        throw new LlmConfigError('API key cannot be empty');
      }
      await preferenceStore.set(PREF_KEYS.apiKey, apiKey.trim());
    },

    async setEnabled(enabled: boolean): Promise<void> {
      await preferenceStore.set(PREF_KEYS.enabled, String(enabled));
    },

    async setMaxTokens(maxTokens: number): Promise<void> {
      if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
        throw new LlmConfigError('maxTokens must be a positive integer', { maxTokens });
      }
      await preferenceStore.set(PREF_KEYS.maxTokens, String(maxTokens));
    },

    async setTemperature(temperature: number): Promise<void> {
      if (isNaN(temperature) || temperature < 0 || temperature > 2) {
        throw new LlmConfigError('Temperature must be between 0 and 2', { temperature });
      }
      await preferenceStore.set(PREF_KEYS.temperature, String(temperature));
    },

    async reset(): Promise<void> {
      for (const key of ALL_PREF_KEYS) {
        await preferenceStore.delete(key);
      }
    },
  };
}
