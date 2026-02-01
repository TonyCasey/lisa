/**
 * LLM Usage Tracker Implementation.
 *
 * Append-only JSON log of LLM usage records stored in `.lisa/llm-usage.json`.
 * Provides cost aggregation and monthly budget enforcement.
 *
 * Part of Phase 6B: Cost/Privacy Controls.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ILlmUsageTracker, ILlmUsageRecord } from '../../domain/interfaces/ILlmUsageTracker';
import type { IPreferenceStore } from '../../domain/interfaces/IPreferenceStore';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { LlmProvider } from '../../domain/interfaces/ILlmService';

/** Usage log file path relative to project root. */
const USAGE_FILE = '.lisa/llm-usage.json';

/** Preference key for monthly budget limit (USD). */
const BUDGET_PREF_KEY = 'llm:monthlyLimit';

/**
 * Estimated cost per million tokens by provider/model category.
 * Values in USD per 1M tokens.
 */
const COST_PER_MILLION: Record<LlmProvider, { input: number; output: number }> = {
  anthropic: { input: 3.0, output: 15.0 },
  openai: { input: 2.5, output: 10.0 },
  ollama: { input: 0, output: 0 },
};

/**
 * Estimate cost for a usage event.
 */
export function estimateCost(
  provider: LlmProvider,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = COST_PER_MILLION[provider] ?? { input: 0, output: 0 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/**
 * Get the start of the current calendar month as a Date.
 */
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Create an LLM usage tracker.
 *
 * @param projectRoot - Project root directory (location of `.lisa/`)
 * @param preferenceStore - Preference store for reading budget limits
 * @param logger - Optional logger
 */
export function createLlmUsageTracker(
  projectRoot: string,
  preferenceStore: IPreferenceStore,
  logger?: ILogger
): ILlmUsageTracker {
  const filePath = path.join(projectRoot, USAGE_FILE);

  /**
   * Read the usage log file. Returns empty array on missing/invalid file.
   */
  async function readLog(): Promise<ILlmUsageRecord[]> {
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        logger?.warn('Invalid llm-usage.json structure, returning empty log');
        return [];
      }
      return parsed as ILlmUsageRecord[];
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        logger?.warn('Invalid JSON in llm-usage.json, returning empty log');
        return [];
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Write the usage log file. Creates `.lisa/` directory if needed.
   */
  async function writeLog(records: ILlmUsageRecord[]): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
    }
    await fsp.writeFile(filePath, JSON.stringify(records, null, 2) + '\n', 'utf-8');
  }

  return {
    async record(usage: Omit<ILlmUsageRecord, 'timestamp'>): Promise<void> {
      const record: ILlmUsageRecord = {
        ...usage,
        timestamp: new Date().toISOString(),
      };
      const records = await readLog();
      records.push(record);
      await writeLog(records);
    },

    async getUsage(since?: Date): Promise<readonly ILlmUsageRecord[]> {
      const records = await readLog();
      if (!since) return records;
      const sinceMs = since.getTime();
      return records.filter(r => new Date(r.timestamp).getTime() >= sinceMs);
    },

    async getTotalCost(since?: Date): Promise<number> {
      const effectiveSince = since ?? startOfCurrentMonth();
      const records = await this.getUsage(effectiveSince);
      return records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    },

    async isWithinBudget(): Promise<boolean> {
      const limitStr = await preferenceStore.get(BUDGET_PREF_KEY);
      if (limitStr === null) return true; // No limit configured
      const limit = parseFloat(limitStr);
      if (isNaN(limit) || limit <= 0) return true; // Invalid limit treated as no limit
      const cost = await this.getTotalCost();
      return cost < limit;
    },
  };
}
