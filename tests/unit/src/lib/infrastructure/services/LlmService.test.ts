/**
 * LlmService Tests.
 *
 * Tests multi-provider completion, request formatting,
 * response parsing, error handling, and availability checks.
 *
 * Uses a global fetch mock to intercept HTTP calls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createLlmService } from '../../../../../../src/lib/infrastructure/services/LlmService';
import type { ILlmConfigService } from '../../../../../../src/lib/domain/interfaces/ILlmConfigService';
import type { ILlmConfig, ILlmService as ILlmServiceType } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import { getDefaultLlmConfig } from '../../../../../../src/lib/domain/interfaces/ILlmService';

// ── Mock fetch ──────────────────────────────────────────────

interface IMockFetchCall {
  url: string;
  init?: RequestInit;
}

let mockFetchCalls: IMockFetchCall[] = [];
let mockFetchResponse: { ok: boolean; status: number; statusText: string; body: unknown } = {
  ok: true, status: 200, statusText: 'OK', body: {},
};

const originalFetch = globalThis.fetch;

function installMockFetch(): void {
  mockFetchCalls = [];
  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    mockFetchCalls.push({ url: urlStr, init });
    return {
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      statusText: mockFetchResponse.statusText,
      json: async () => mockFetchResponse.body,
      text: async () => JSON.stringify(mockFetchResponse.body),
    };
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ── Mock config service ─────────────────────────────────────

function createMockConfigService(overrides: Partial<ILlmConfig> = {}): ILlmConfigService {
  const config: ILlmConfig = {
    ...getDefaultLlmConfig(),
    enabled: true,
    apiKey: 'sk-test-key',
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

// ── Tests ───────────────────────────────────────────────────

describe('LlmService', () => {
  let svc: ILlmServiceType;

  beforeEach(() => {
    installMockFetch();
    mockFetchResponse = { ok: true, status: 200, statusText: 'OK', body: {} };
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('complete() with anthropic', () => {
    beforeEach(() => {
      const configSvc = createMockConfigService({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-20250514',
      };
    });

    it('should format correct Anthropic request', async () => {
      await svc.complete('Test prompt');

      assert.strictEqual(mockFetchCalls.length, 1);
      const call = mockFetchCalls[0];
      assert.ok(call.url.includes('/v1/messages'));

      const headers = call.init?.headers as Record<string, string>;
      assert.strictEqual(headers['x-api-key'], 'sk-test-key');
      assert.strictEqual(headers['anthropic-version'], '2023-06-01');

      const body = JSON.parse(call.init?.body as string);
      assert.strictEqual(body.model, 'claude-sonnet-4-20250514');
      assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'Test prompt' }]);
    });

    it('should include system prompt when provided', async () => {
      await svc.complete('Test prompt', { systemPrompt: 'You are helpful.' });

      const body = JSON.parse(mockFetchCalls[0].init?.body as string);
      assert.strictEqual(body.system, 'You are helpful.');
    });

    it('should parse Anthropic response', async () => {
      const response = await svc.complete('Test prompt');

      assert.strictEqual(response.text, 'Hello from Claude!');
      assert.strictEqual(response.provider, 'anthropic');
      assert.strictEqual(response.model, 'claude-sonnet-4-20250514');
      assert.strictEqual(response.usage.inputTokens, 10);
      assert.strictEqual(response.usage.outputTokens, 5);
      assert.strictEqual(response.usage.totalTokens, 15);
    });
  });

  describe('complete() with openai', () => {
    beforeEach(() => {
      const configSvc = createMockConfigService({ provider: 'openai', model: 'gpt-4o' });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        choices: [{ message: { content: 'Hello from GPT!' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        model: 'gpt-4o',
      };
    });

    it('should format correct OpenAI request', async () => {
      await svc.complete('Test prompt');

      assert.strictEqual(mockFetchCalls.length, 1);
      const call = mockFetchCalls[0];
      assert.ok(call.url.includes('/v1/chat/completions'));

      const headers = call.init?.headers as Record<string, string>;
      assert.strictEqual(headers['Authorization'], 'Bearer sk-test-key');

      const body = JSON.parse(call.init?.body as string);
      assert.strictEqual(body.model, 'gpt-4o');
      assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'Test prompt' }]);
    });

    it('should prepend system message when systemPrompt provided', async () => {
      await svc.complete('Test prompt', { systemPrompt: 'You are helpful.' });

      const body = JSON.parse(mockFetchCalls[0].init?.body as string);
      assert.strictEqual(body.messages.length, 2);
      assert.deepStrictEqual(body.messages[0], { role: 'system', content: 'You are helpful.' });
      assert.deepStrictEqual(body.messages[1], { role: 'user', content: 'Test prompt' });
    });

    it('should parse OpenAI response', async () => {
      const response = await svc.complete('Test prompt');

      assert.strictEqual(response.text, 'Hello from GPT!');
      assert.strictEqual(response.provider, 'openai');
      assert.strictEqual(response.model, 'gpt-4o');
      assert.strictEqual(response.usage.inputTokens, 8);
      assert.strictEqual(response.usage.outputTokens, 4);
      assert.strictEqual(response.usage.totalTokens, 12);
    });
  });

  describe('complete() with ollama', () => {
    beforeEach(() => {
      const configSvc = createMockConfigService({ provider: 'ollama', model: 'llama3', apiKey: undefined });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        response: 'Hello from Llama!',
        model: 'llama3',
        prompt_eval_count: 12,
        eval_count: 6,
      };
    });

    it('should format correct Ollama request', async () => {
      await svc.complete('Test prompt');

      assert.strictEqual(mockFetchCalls.length, 1);
      const call = mockFetchCalls[0];
      assert.ok(call.url.includes('/api/generate'));

      const body = JSON.parse(call.init?.body as string);
      assert.strictEqual(body.model, 'llama3');
      assert.strictEqual(body.prompt, 'Test prompt');
      assert.strictEqual(body.stream, false);
    });

    it('should set system field when systemPrompt provided', async () => {
      await svc.complete('Test prompt', { systemPrompt: 'You are helpful.' });

      const body = JSON.parse(mockFetchCalls[0].init?.body as string);
      assert.strictEqual(body.system, 'You are helpful.');
    });

    it('should parse Ollama response', async () => {
      const response = await svc.complete('Test prompt');

      assert.strictEqual(response.text, 'Hello from Llama!');
      assert.strictEqual(response.provider, 'ollama');
      assert.strictEqual(response.model, 'llama3');
      assert.strictEqual(response.usage.inputTokens, 12);
      assert.strictEqual(response.usage.outputTokens, 6);
      assert.strictEqual(response.usage.totalTokens, 18);
    });
  });

  describe('complete() error handling', () => {
    it('should throw LlmDisabledError when disabled', async () => {
      const configSvc = createMockConfigService({ enabled: false });
      svc = createLlmService(configSvc);

      await assert.rejects(
        async () => svc.complete('Test'),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmDisabledError');
          return true;
        }
      );
    });

    it('should throw LlmProviderError on HTTP error', async () => {
      const configSvc = createMockConfigService({ provider: 'anthropic' });
      svc = createLlmService(configSvc);

      mockFetchResponse = {
        ok: false, status: 429, statusText: 'Too Many Requests',
        body: { error: 'rate limited' },
      };

      await assert.rejects(
        async () => svc.complete('Test'),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmProviderError');
          assert.strictEqual(error.statusCode, 429);
          return true;
        }
      );
    });

    it('should throw LlmConfigError when API key missing for anthropic', async () => {
      const configSvc = createMockConfigService({ provider: 'anthropic', apiKey: undefined });
      svc = createLlmService(configSvc);

      await assert.rejects(
        async () => svc.complete('Test'),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });

    it('should throw LlmConfigError when API key missing for openai', async () => {
      const configSvc = createMockConfigService({ provider: 'openai', apiKey: undefined });
      svc = createLlmService(configSvc);

      await assert.rejects(
        async () => svc.complete('Test'),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });

    it('should not require API key for ollama', async () => {
      const configSvc = createMockConfigService({ provider: 'ollama', model: 'llama3', apiKey: undefined });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        response: 'Hello!', model: 'llama3',
        prompt_eval_count: 5, eval_count: 3,
      };

      const response = await svc.complete('Test');
      assert.strictEqual(response.text, 'Hello!');
    });
  });

  describe('complete() with custom options', () => {
    it('should override maxTokens and temperature from options', async () => {
      const configSvc = createMockConfigService({ provider: 'anthropic', maxTokens: 1024, temperature: 0.3 });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 5, output_tokens: 3 },
      };

      await svc.complete('Test', { maxTokens: 2048, temperature: 0.9 });

      const body = JSON.parse(mockFetchCalls[0].init?.body as string);
      assert.strictEqual(body.max_tokens, 2048);
      assert.strictEqual(body.temperature, 0.9);
    });
  });

  describe('complete() with custom endpoint', () => {
    it('should use custom endpoint for anthropic', async () => {
      const configSvc = createMockConfigService({ provider: 'anthropic', endpoint: 'https://custom-anthropic.com' });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        content: [{ type: 'text', text: 'Custom' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };

      await svc.complete('Test');
      assert.ok(mockFetchCalls[0].url.startsWith('https://custom-anthropic.com'));
    });

    it('should use custom endpoint for openai', async () => {
      const configSvc = createMockConfigService({ provider: 'openai', endpoint: 'https://custom-openai.com' });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = {
        choices: [{ message: { content: 'Custom' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };

      await svc.complete('Test');
      assert.ok(mockFetchCalls[0].url.startsWith('https://custom-openai.com'));
    });

    it('should use custom endpoint for ollama', async () => {
      const configSvc = createMockConfigService({ provider: 'ollama', model: 'llama3', apiKey: undefined, endpoint: 'http://remote:11434' });
      svc = createLlmService(configSvc);

      mockFetchResponse.body = { response: 'Custom', model: 'llama3' };

      await svc.complete('Test');
      assert.ok(mockFetchCalls[0].url.startsWith('http://remote:11434'));
    });
  });

  describe('isAvailable()', () => {
    it('should return false when disabled', async () => {
      const configSvc = createMockConfigService({ enabled: false });
      svc = createLlmService(configSvc);

      const available = await svc.isAvailable();
      assert.strictEqual(available, false);
    });

    it('should return false when API key missing for anthropic', async () => {
      const configSvc = createMockConfigService({ provider: 'anthropic', apiKey: undefined });
      svc = createLlmService(configSvc);

      const available = await svc.isAvailable();
      assert.strictEqual(available, false);
    });

    it('should return true for ollama when endpoint reachable', async () => {
      const configSvc = createMockConfigService({ provider: 'ollama', model: 'llama3', apiKey: undefined });
      svc = createLlmService(configSvc);

      mockFetchResponse = { ok: true, status: 200, statusText: 'OK', body: { models: [] } };

      const available = await svc.isAvailable();
      assert.strictEqual(available, true);
    });
  });

  describe('getConfig()', () => {
    it('should return resolved config', async () => {
      const configSvc = createMockConfigService({ provider: 'openai', model: 'gpt-4o' });
      svc = createLlmService(configSvc);

      const config = await svc.getConfig();
      assert.strictEqual(config.provider, 'openai');
      assert.strictEqual(config.model, 'gpt-4o');
    });
  });
});
