/**
 * Natural Language Curation Service Interface.
 *
 * Defines the contract for translating natural language memory
 * management commands into structured operations. Supports intent
 * classification (query, mark, expire, summarize, consolidate)
 * with plan-then-execute workflow for destructive actions.
 *
 * Part of Phase 6E: Natural Language Curation.
 */

import type { ILlmUsage } from './ILlmService';

/**
 * Recognized curation intents.
 */
export type NlCurationIntent = 'query' | 'mark' | 'expire' | 'summarize' | 'consolidate';

/**
 * All valid NL curation intents.
 */
export const NL_CURATION_INTENT_VALUES: readonly NlCurationIntent[] = [
  'query',
  'mark',
  'expire',
  'summarize',
  'consolidate',
] as const;

/**
 * Check if a string is a valid NlCurationIntent.
 */
export function isValidNlCurationIntent(value: string): value is NlCurationIntent {
  return NL_CURATION_INTENT_VALUES.includes(value as NlCurationIntent);
}

/**
 * A single operation within a curation plan.
 */
export interface INlOperation {
  readonly type: 'search' | 'mark' | 'expire' | 'summarize' | 'consolidate';
  readonly params: Readonly<Record<string, unknown>>;
  readonly description: string;
}

/**
 * A plan generated from natural language input.
 * Presented to the user before execution.
 */
export interface INlCurationPlan {
  readonly intent: NlCurationIntent;
  readonly description: string;
  readonly isDestructive: boolean;
  readonly operations: readonly INlOperation[];
  readonly usage: ILlmUsage;
}

/**
 * Result of executing a curation plan.
 */
export interface INlCurationResult {
  readonly plan: INlCurationPlan;
  readonly executed: boolean;
  readonly output: string;
  readonly usage: ILlmUsage;
}

/**
 * Natural language curation service.
 * Translates natural language into structured memory operations.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface INlCurationService {
  /**
   * Plan operations from natural language input.
   * Does NOT execute — returns a plan for user review.
   *
   * @param input - Natural language command
   * @throws LlmDisabledError if LLM is disabled
   * @throws LlmFeatureDisabledError if curation feature is disabled
   */
  plan(input: string): Promise<INlCurationPlan>;

  /**
   * Execute a previously generated plan.
   *
   * @param plan - The plan to execute
   */
  execute(plan: INlCurationPlan): Promise<INlCurationResult>;
}
