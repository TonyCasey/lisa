/**
 * LLM Usage Tracker Interface.
 *
 * Tracks token usage and estimated cost per LLM operation.
 * Supports monthly budget enforcement and per-feature tracking.
 *
 * Part of Phase 6B: Cost/Privacy Controls.
 */

import type { LlmProvider } from './ILlmService';

/**
 * LLM feature identifiers for per-feature tracking and toggles.
 */
export type LlmFeature = 'summarization' | 'extraction' | 'deduplication' | 'curation' | 'test';

/**
 * All valid LLM feature values.
 */
export const LLM_FEATURE_VALUES: readonly LlmFeature[] = [
  'summarization',
  'extraction',
  'deduplication',
  'curation',
  'test',
] as const;

/**
 * Type guard for LlmFeature.
 */
export function isValidLlmFeature(value: string): value is LlmFeature {
  return LLM_FEATURE_VALUES.includes(value as LlmFeature);
}

/**
 * A single LLM usage record.
 */
export interface ILlmUsageRecord {
  readonly timestamp: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly feature: LlmFeature;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

/**
 * LLM usage tracker.
 * Append-only log of usage records with cost aggregation and budget checks.
 */
export interface ILlmUsageTracker {
  /**
   * Record a usage event.
   */
  record(usage: Omit<ILlmUsageRecord, 'timestamp'>): Promise<void>;

  /**
   * Get usage records, optionally filtered by date.
   * @param since - Only return records after this date
   */
  getUsage(since?: Date): Promise<readonly ILlmUsageRecord[]>;

  /**
   * Get total estimated cost, optionally filtered by date.
   * Defaults to current calendar month if no date provided.
   * @param since - Only sum costs after this date
   */
  getTotalCost(since?: Date): Promise<number>;

  /**
   * Check if usage is within the configured monthly budget.
   * Returns true if no budget limit is configured.
   */
  isWithinBudget(): Promise<boolean>;
}
