/**
 * LLM Service Implementation.
 *
 * Multi-provider LLM service using native fetch (Node 18+).
 * Routes completion requests to Anthropic, OpenAI, or Ollama based on config.
 *
 * Part of Phase 6A: LLM Provider Abstraction Layer.
 */

import type { ILlmConfigService } from '../../domain/interfaces/ILlmConfigService';
import type {
  ILlmService,
  ILlmConfig,
  ILlmResponse,
  ILlmUsage,
  ILlmRequestOptions,
  LlmProvider,
} from '../../domain/interfaces/ILlmService';
import type { ILogger } from '../../domain/interfaces/ILogger';
import { LlmDisabledError, LlmProviderError, LlmConfigError } from '../../domain/errors/LlmErrors';

/** Default endpoints per provider. */
const DEFAULT_ENDPOINTS: Record<LlmProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  ollama: 'http://localhost:11434',
};

/**
 * Create an LLM service.
 *
 * @param configService - LLM config service for resolving configuration
 * @param logger - Optional logger
 */
export function createLlmService(
  configService: ILlmConfigService,
  logger?: ILogger
): ILlmService {

  /**
   * Validate that API key is present for providers that require it.
   */
  function requireApiKey(config: ILlmConfig): string {
    if (!config.apiKey) {
      throw new LlmConfigError(
        `API key required for ${config.provider} provider. Set via: lisa llm config --api-key <key> or ${config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} env var`,
        { provider: config.provider }
      );
    }
    return config.apiKey;
  }

  /**
   * Get the effective endpoint for a provider.
   */
  function getEndpoint(config: ILlmConfig): string {
    return config.endpoint || DEFAULT_ENDPOINTS[config.provider];
  }

  /**
   * Send a completion request to Anthropic.
   */
  async function completeAnthropic(
    prompt: string,
    config: ILlmConfig,
    options: ILlmRequestOptions
  ): Promise<ILlmResponse> {
    const apiKey = requireApiKey(config);
    const endpoint = getEndpoint(config);
    const maxTokens = options.maxTokens ?? config.maxTokens;
    const temperature = options.temperature ?? config.temperature;

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const response = await fetch(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LlmProviderError(
        `Anthropic API error: ${response.status} ${response.statusText}`,
        response.status,
        { provider: 'anthropic', model: config.model, body: errorBody }
      );
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };

    const text = data.content?.find(c => c.type === 'text')?.text ?? '';
    const usage: ILlmUsage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };

    return { text, usage, model: data.model ?? config.model, provider: 'anthropic' };
  }

  /**
   * Send a completion request to OpenAI.
   */
  async function completeOpenAI(
    prompt: string,
    config: ILlmConfig,
    options: ILlmRequestOptions
  ): Promise<ILlmResponse> {
    const apiKey = requireApiKey(config);
    const endpoint = getEndpoint(config);
    const maxTokens = options.maxTokens ?? config.maxTokens;
    const temperature = options.temperature ?? config.temperature;

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LlmProviderError(
        `OpenAI API error: ${response.status} ${response.statusText}`,
        response.status,
        { provider: 'openai', model: config.model, body: errorBody }
      );
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const usage: ILlmUsage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    return { text, usage, model: data.model ?? config.model, provider: 'openai' };
  }

  /**
   * Send a completion request to Ollama.
   */
  async function completeOllama(
    prompt: string,
    config: ILlmConfig,
    options: ILlmRequestOptions
  ): Promise<ILlmResponse> {
    const endpoint = getEndpoint(config);

    const body: Record<string, unknown> = {
      model: config.model,
      prompt,
      stream: false,
      options: {
        num_predict: options.maxTokens ?? config.maxTokens,
        temperature: options.temperature ?? config.temperature,
      },
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LlmProviderError(
        `Ollama API error: ${response.status} ${response.statusText}`,
        response.status,
        { provider: 'ollama', model: config.model, body: errorBody }
      );
    }

    const data = await response.json() as {
      response?: string;
      model?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const text = data.response ?? '';
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    const usage: ILlmUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    return { text, usage, model: data.model ?? config.model, provider: 'ollama' };
  }

  return {
    async complete(prompt: string, options?: ILlmRequestOptions): Promise<ILlmResponse> {
      const config = await configService.getConfig();

      if (!config.enabled) {
        throw new LlmDisabledError();
      }

      const opts: ILlmRequestOptions = options ?? {};

      let response: ILlmResponse;
      switch (config.provider) {
        case 'anthropic':
          response = await completeAnthropic(prompt, config, opts);
          break;
        case 'openai':
          response = await completeOpenAI(prompt, config, opts);
          break;
        case 'ollama':
          response = await completeOllama(prompt, config, opts);
          break;
        default:
          throw new LlmConfigError(`Unsupported provider: ${config.provider as string}`);
      }

      logger?.debug('LLM completion', {
        provider: response.provider,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });

      return response;
    },

    async isAvailable(): Promise<boolean> {
      try {
        const config = await configService.getConfig();
        if (!config.enabled) return false;

        const endpoint = getEndpoint(config);

        switch (config.provider) {
          case 'anthropic': {
            if (!config.apiKey) return false;
            const resp = await fetch(`${endpoint}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
              signal: AbortSignal.timeout(10000),
            });
            return resp.ok || resp.status < 500;
          }
          case 'openai': {
            if (!config.apiKey) return false;
            const resp = await fetch(`${endpoint}/v1/models`, {
              headers: { 'Authorization': `Bearer ${config.apiKey}` },
              signal: AbortSignal.timeout(10000),
            });
            return resp.ok;
          }
          case 'ollama': {
            const resp = await fetch(`${endpoint}/api/tags`, {
              signal: AbortSignal.timeout(5000),
            });
            return resp.ok;
          }
          default:
            return false;
        }
      } catch {
        return false;
      }
    },

    async getConfig(): Promise<ILlmConfig> {
      return configService.getConfig();
    },
  };
}
