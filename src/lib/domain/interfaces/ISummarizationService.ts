/**
 * Summarization Service Interface.
 *
 * Produces LLM-generated summaries of accumulated memory facts.
 * Supports date filtering, topic filtering, and style options.
 *
 * Part of Phase 6B: AI-Powered Memory Summarization.
 */

import type { ILlmUsage } from './ILlmService';

/**
 * Result of a summarization operation.
 */
export interface ISummarizationResult {
  readonly summary: string;
  readonly factCount: number;
  readonly timeRange: { readonly from: string; readonly to: string };
  readonly topics: readonly string[];
  readonly usage: ILlmUsage;
}

/**
 * Options for summarization.
 */
export interface ISummarizationOptions {
  /** Only include facts created after this date. */
  readonly since?: Date;
  /** Filter facts by topic tag. */
  readonly topic?: string;
  /** Maximum number of facts to send to the LLM (default: 50). */
  readonly maxFacts?: number;
  /** Summary style: concise (2-3 paragraphs) or detailed (4-6 paragraphs). */
  readonly style?: 'concise' | 'detailed';
}

/**
 * Summarization service.
 * Produces LLM-generated digests of project memory facts.
 */
export interface ISummarizationService {
  /**
   * Summarize memory facts for a group.
   *
   * @param groupId - Group ID to summarize facts from
   * @param options - Optional filters and style settings
   * @throws LlmDisabledError if LLM is disabled
   * @throws LlmFeatureDisabledError if summarization feature is disabled
   */
  summarize(
    groupId: string,
    options?: ISummarizationOptions
  ): Promise<ISummarizationResult>;
}
