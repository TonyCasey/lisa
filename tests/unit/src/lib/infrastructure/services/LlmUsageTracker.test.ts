/**
 * LlmUsageTracker Tests.
 *
 * Tests append-only usage logging, cost aggregation,
 * date filtering, and budget enforcement.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLlmUsageTracker, estimateCost } from '../../../../../../src/lib/infrastructure/services/LlmUsageTracker';
import type { IPreferenceStore } from '../../../../../../src/lib/domain/interfaces/IPreferenceStore';

// ── Mock preference store ──────────────────────────────────

function createMockPreferenceStore(prefs: Record<string, string> = {}): IPreferenceStore {
  const store = new Map<string, string>(Object.entries(prefs));
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { return store.delete(key); },
    async list() { return Array.from(store.entries()).map(([key, value]) => ({ key, value, updatedAt: new Date().toISOString() })); },
    async has(key: string) { return store.has(key); },
  };
}

// ── Helpers ────────────────────────────────────────────────

let tmpDir: string;

async function createTmpDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lisa-usage-test-'));
  await fsp.mkdir(path.join(dir, '.lisa'), { recursive: true });
  return dir;
}

// ── Tests ──────────────────────────────────────────────────

describe('LlmUsageTracker', () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('record()', () => {
    it('should append a usage record to the log file', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.001,
      });

      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0]?.provider, 'anthropic');
      assert.strictEqual(records[0]?.feature, 'test');
      assert.strictEqual(records[0]?.inputTokens, 100);
      assert.ok(records[0]?.timestamp);
    });

    it('should append multiple records', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'summarization',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.001,
      });

      await tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        feature: 'deduplication',
        inputTokens: 200,
        outputTokens: 100,
        estimatedCostUsd: 0.002,
      });

      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 2);
    });

    it('should create .lisa directory if missing', async () => {
      const dirWithoutLisa = await fsp.mkdtemp(path.join(os.tmpdir(), 'lisa-usage-nodir-'));
      const tracker = createLlmUsageTracker(dirWithoutLisa, createMockPreferenceStore());

      await tracker.record({
        provider: 'ollama',
        model: 'llama3',
        feature: 'test',
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
      });

      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 1);

      await fsp.rm(dirWithoutLisa, { recursive: true, force: true });
    });
  });

  describe('getUsage()', () => {
    it('should return all records when no since date', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.001,
      });

      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 1);
    });

    it('should filter by since date', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      // Write records with specific timestamps
      const usageFile = path.join(tmpDir, '.lisa', 'llm-usage.json');
      const oldRecord = {
        timestamp: '2025-01-01T00:00:00.000Z',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.001,
      };
      const newRecord = {
        timestamp: '2025-06-15T00:00:00.000Z',
        provider: 'openai',
        model: 'gpt-4o',
        feature: 'summarization',
        inputTokens: 200,
        outputTokens: 100,
        estimatedCostUsd: 0.002,
      };
      await fsp.writeFile(usageFile, JSON.stringify([oldRecord, newRecord]));

      const since = new Date('2025-06-01T00:00:00.000Z');
      const records = await tracker.getUsage(since);
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0]?.provider, 'openai');
    });

    it('should return empty array when no records exist', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());
      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 0);
    });

    it('should handle invalid JSON gracefully', async () => {
      const usageFile = path.join(tmpDir, '.lisa', 'llm-usage.json');
      await fsp.writeFile(usageFile, 'not-json');

      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());
      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 0);
    });

    it('should handle non-array JSON gracefully', async () => {
      const usageFile = path.join(tmpDir, '.lisa', 'llm-usage.json');
      await fsp.writeFile(usageFile, JSON.stringify({ not: 'an array' }));

      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());
      const records = await tracker.getUsage();
      assert.strictEqual(records.length, 0);
    });
  });

  describe('getTotalCost()', () => {
    it('should sum costs for current month by default', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      // Write a record dated today
      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.005,
      });

      await tracker.record({
        provider: 'openai',
        model: 'gpt-4o',
        feature: 'summarization',
        inputTokens: 200,
        outputTokens: 100,
        estimatedCostUsd: 0.003,
      });

      const cost = await tracker.getTotalCost();
      assert.ok(cost >= 0.008); // Both should be in current month
    });

    it('should respect since date parameter', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());

      const usageFile = path.join(tmpDir, '.lisa', 'llm-usage.json');
      await fsp.writeFile(usageFile, JSON.stringify([
        { timestamp: '2025-01-01T00:00:00.000Z', provider: 'anthropic', model: 'claude', feature: 'test', inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01 },
        { timestamp: '2025-06-15T00:00:00.000Z', provider: 'openai', model: 'gpt-4o', feature: 'test', inputTokens: 200, outputTokens: 100, estimatedCostUsd: 0.02 },
      ]));

      const cost = await tracker.getTotalCost(new Date('2025-06-01T00:00:00.000Z'));
      assert.ok(Math.abs(cost - 0.02) < 0.001);
    });
  });

  describe('isWithinBudget()', () => {
    it('should return true when no budget limit is set', async () => {
      const tracker = createLlmUsageTracker(tmpDir, createMockPreferenceStore());
      const result = await tracker.isWithinBudget();
      assert.strictEqual(result, true);
    });

    it('should return true when under budget', async () => {
      const prefs = createMockPreferenceStore({ 'llm:monthlyLimit': '10.00' });
      const tracker = createLlmUsageTracker(tmpDir, prefs);

      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.001,
      });

      const result = await tracker.isWithinBudget();
      assert.strictEqual(result, true);
    });

    it('should return false when over budget', async () => {
      const prefs = createMockPreferenceStore({ 'llm:monthlyLimit': '0.001' });
      const tracker = createLlmUsageTracker(tmpDir, prefs);

      await tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'test',
        inputTokens: 100000,
        outputTokens: 50000,
        estimatedCostUsd: 1.0,
      });

      const result = await tracker.isWithinBudget();
      assert.strictEqual(result, false);
    });

    it('should return true for invalid budget limit', async () => {
      const prefs = createMockPreferenceStore({ 'llm:monthlyLimit': 'not-a-number' });
      const tracker = createLlmUsageTracker(tmpDir, prefs);
      const result = await tracker.isWithinBudget();
      assert.strictEqual(result, true);
    });
  });
});

describe('estimateCost()', () => {
  it('should estimate anthropic costs correctly', () => {
    // 1M input tokens at $3/M + 1M output tokens at $15/M = $18
    const cost = estimateCost('anthropic', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - 18.0) < 0.01);
  });

  it('should estimate openai costs correctly', () => {
    // 1M input tokens at $2.5/M + 1M output tokens at $10/M = $12.5
    const cost = estimateCost('openai', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - 12.5) < 0.01);
  });

  it('should return 0 for ollama', () => {
    const cost = estimateCost('ollama', 1_000_000, 1_000_000);
    assert.strictEqual(cost, 0);
  });

  it('should handle small token counts', () => {
    // 100 input + 50 output for anthropic
    const cost = estimateCost('anthropic', 100, 50);
    assert.ok(cost > 0);
    assert.ok(cost < 0.01);
  });
});
