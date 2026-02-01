/**
 * LlmConfigService Tests.
 *
 * Tests configuration resolution, preference persistence,
 * environment variable overrides, and validation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLlmConfigService } from '../../../../../../src/lib/infrastructure/services/LlmConfigService';
import { createPreferenceStore } from '../../../../../../src/lib/infrastructure/services/PreferenceStore';
import type { ILlmConfigService } from '../../../../../../src/lib/domain/interfaces/ILlmConfigService';
import type { IPreferenceStore } from '../../../../../../src/lib/domain/interfaces/IPreferenceStore';
import { getDefaultLlmConfig } from '../../../../../../src/lib/domain/interfaces/ILlmService';

describe('LlmConfigService', () => {
  let tmpDir: string;
  let store: IPreferenceStore;
  let configSvc: ILlmConfigService;

  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    'LISA_LLM_PROVIDER', 'LISA_LLM_MODEL', 'LISA_LLM_ENDPOINT',
    'LISA_LLM_API_KEY', 'LISA_LLM_ENABLED',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-llm-config-test-'));
    store = createPreferenceStore(tmpDir);
    configSvc = createLlmConfigService(store);

    for (const key of envKeys) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });

    for (const key of envKeys) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('getConfig()', () => {
    it('should return defaults when no preferences are set', async () => {
      const config = await configSvc.getConfig();
      const defaults = getDefaultLlmConfig();

      assert.strictEqual(config.provider, defaults.provider);
      assert.strictEqual(config.model, defaults.model);
      assert.strictEqual(config.enabled, defaults.enabled);
      assert.strictEqual(config.maxTokens, defaults.maxTokens);
      assert.strictEqual(config.temperature, defaults.temperature);
      assert.strictEqual(config.endpoint, undefined);
      assert.strictEqual(config.apiKey, undefined);
    });

    it('should read from preference store', async () => {
      await store.set('llm:provider', 'openai');
      await store.set('llm:model', 'gpt-4o');
      await store.set('llm:enabled', 'true');
      await store.set('llm:maxTokens', '2048');
      await store.set('llm:temperature', '0.7');
      await store.set('llm:endpoint', 'https://custom.endpoint.com');
      await store.set('llm:apiKey', 'sk-test-key');

      const config = await configSvc.getConfig();

      assert.strictEqual(config.provider, 'openai');
      assert.strictEqual(config.model, 'gpt-4o');
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.maxTokens, 2048);
      assert.strictEqual(config.temperature, 0.7);
      assert.strictEqual(config.endpoint, 'https://custom.endpoint.com');
      assert.strictEqual(config.apiKey, 'sk-test-key');
    });

    it('should let environment variables override preferences', async () => {
      await store.set('llm:provider', 'openai');
      await store.set('llm:model', 'gpt-4o');
      await store.set('llm:enabled', 'false');

      process.env.LISA_LLM_PROVIDER = 'anthropic';
      process.env.LISA_LLM_MODEL = 'claude-3-5-sonnet';
      process.env.LISA_LLM_ENABLED = 'true';

      const config = await configSvc.getConfig();

      assert.strictEqual(config.provider, 'anthropic');
      assert.strictEqual(config.model, 'claude-3-5-sonnet');
      assert.strictEqual(config.enabled, true);
    });

    it('should use ANTHROPIC_API_KEY as fallback when provider is anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fallback';

      const config = await configSvc.getConfig();

      assert.strictEqual(config.provider, 'anthropic');
      assert.strictEqual(config.apiKey, 'sk-ant-fallback');
    });

    it('should use OPENAI_API_KEY as fallback when provider is openai', async () => {
      await store.set('llm:provider', 'openai');
      process.env.OPENAI_API_KEY = 'sk-openai-fallback';

      const config = await configSvc.getConfig();

      assert.strictEqual(config.provider, 'openai');
      assert.strictEqual(config.apiKey, 'sk-openai-fallback');
    });

    it('should prefer LISA_LLM_API_KEY over provider-specific key', async () => {
      process.env.LISA_LLM_API_KEY = 'sk-direct';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fallback';

      const config = await configSvc.getConfig();

      assert.strictEqual(config.apiKey, 'sk-direct');
    });

    it('should merge in order: defaults <- prefs <- env vars', async () => {
      await store.set('llm:model', 'pref-model');
      process.env.LISA_LLM_MODEL = 'env-model';

      const config = await configSvc.getConfig();
      assert.strictEqual(config.model, 'env-model');
    });

    it('should ignore invalid provider in preferences', async () => {
      await store.set('llm:provider', 'invalid-provider');

      const config = await configSvc.getConfig();
      assert.strictEqual(config.provider, 'anthropic');
    });

    it('should ignore invalid maxTokens in preferences', async () => {
      await store.set('llm:maxTokens', 'not-a-number');

      const config = await configSvc.getConfig();
      assert.strictEqual(config.maxTokens, getDefaultLlmConfig().maxTokens);
    });

    it('should ignore out-of-range temperature in preferences', async () => {
      await store.set('llm:temperature', '3.0');

      const config = await configSvc.getConfig();
      assert.strictEqual(config.temperature, getDefaultLlmConfig().temperature);
    });

    it('should apply endpoint from env var override', async () => {
      process.env.LISA_LLM_ENDPOINT = 'https://env-endpoint.com';

      const config = await configSvc.getConfig();
      assert.strictEqual(config.endpoint, 'https://env-endpoint.com');
    });
  });

  describe('setProvider()', () => {
    it('should store valid provider', async () => {
      await configSvc.setProvider('openai');
      const config = await configSvc.getConfig();
      assert.strictEqual(config.provider, 'openai');
    });

    it('should store ollama provider', async () => {
      await configSvc.setProvider('ollama');
      const config = await configSvc.getConfig();
      assert.strictEqual(config.provider, 'ollama');
    });

    it('should reject invalid provider', async () => {
      await assert.rejects(
        async () => configSvc.setProvider('invalid' as any),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('setModel()', () => {
    it('should store model name', async () => {
      await configSvc.setModel('gpt-4o');
      const config = await configSvc.getConfig();
      assert.strictEqual(config.model, 'gpt-4o');
    });

    it('should reject empty model name', async () => {
      await assert.rejects(
        async () => configSvc.setModel(''),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('setEndpoint()', () => {
    it('should store endpoint', async () => {
      await configSvc.setEndpoint('https://custom.api.com');
      const config = await configSvc.getConfig();
      assert.strictEqual(config.endpoint, 'https://custom.api.com');
    });

    it('should reject empty endpoint', async () => {
      await assert.rejects(
        async () => configSvc.setEndpoint('  '),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('setApiKey()', () => {
    it('should store API key', async () => {
      await configSvc.setApiKey('sk-test-key-123');
      const config = await configSvc.getConfig();
      assert.strictEqual(config.apiKey, 'sk-test-key-123');
    });

    it('should reject empty API key', async () => {
      await assert.rejects(
        async () => configSvc.setApiKey(''),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('setEnabled()', () => {
    it('should enable LLM features', async () => {
      await configSvc.setEnabled(true);
      const config = await configSvc.getConfig();
      assert.strictEqual(config.enabled, true);
    });

    it('should disable LLM features', async () => {
      await configSvc.setEnabled(true);
      await configSvc.setEnabled(false);
      const config = await configSvc.getConfig();
      assert.strictEqual(config.enabled, false);
    });
  });

  describe('setMaxTokens()', () => {
    it('should store valid maxTokens', async () => {
      await configSvc.setMaxTokens(4096);
      const config = await configSvc.getConfig();
      assert.strictEqual(config.maxTokens, 4096);
    });

    it('should reject zero', async () => {
      await assert.rejects(
        async () => configSvc.setMaxTokens(0),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });

    it('should reject negative value', async () => {
      await assert.rejects(
        async () => configSvc.setMaxTokens(-1),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('setTemperature()', () => {
    it('should store valid temperature', async () => {
      await configSvc.setTemperature(1.5);
      const config = await configSvc.getConfig();
      assert.strictEqual(config.temperature, 1.5);
    });

    it('should reject temperature above 2', async () => {
      await assert.rejects(
        async () => configSvc.setTemperature(2.1),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });

    it('should reject negative temperature', async () => {
      await assert.rejects(
        async () => configSvc.setTemperature(-0.1),
        (error: any) => {
          assert.strictEqual(error.name, 'LlmConfigError');
          return true;
        }
      );
    });
  });

  describe('reset()', () => {
    it('should clear all llm preferences and return to defaults', async () => {
      await configSvc.setProvider('openai');
      await configSvc.setModel('gpt-4o');
      await configSvc.setEndpoint('https://custom.api.com');
      await configSvc.setApiKey('sk-test');
      await configSvc.setEnabled(true);
      await configSvc.setMaxTokens(4096);
      await configSvc.setTemperature(1.0);

      await configSvc.reset();

      const config = await configSvc.getConfig();
      const defaults = getDefaultLlmConfig();

      assert.strictEqual(config.provider, defaults.provider);
      assert.strictEqual(config.model, defaults.model);
      assert.strictEqual(config.enabled, defaults.enabled);
      assert.strictEqual(config.maxTokens, defaults.maxTokens);
      assert.strictEqual(config.temperature, defaults.temperature);
    });
  });
});
