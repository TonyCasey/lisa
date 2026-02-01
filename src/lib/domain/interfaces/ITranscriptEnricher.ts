/**
 * Transcript Enricher Interface.
 *
 * Defines the contract for LLM-powered extraction of structured facts
 * from session transcripts. Extracts decisions, learnings, blockers,
 * tasks, preferences, conventions, and gotchas with confidence levels.
 *
 * Part of Phase 6C: Enhanced Session Transcript Extraction.
 */

import type { ILlmUsage } from './ILlmService';
import type { ConfidenceLevel } from './types/IMemoryQuality';
import type { IWorkSummary } from './IWorkSummary';

/**
 * Fact type extracted from a session transcript.
 */
export type ExtractedFactType =
  | 'decision'
  | 'learning'
  | 'blocker'
  | 'task'
  | 'preference'
  | 'convention'
  | 'gotcha';

/**
 * All valid extracted fact types.
 */
export const EXTRACTED_FACT_TYPE_VALUES: readonly ExtractedFactType[] = [
  'decision',
  'learning',
  'blocker',
  'task',
  'preference',
  'convention',
  'gotcha',
] as const;

/**
 * Type guard for ExtractedFactType.
 */
export function isValidExtractedFactType(value: string): value is ExtractedFactType {
  return EXTRACTED_FACT_TYPE_VALUES.includes(value as ExtractedFactType);
}

/**
 * A structured fact extracted by the LLM from a transcript.
 */
export interface IExtractedFact {
  readonly text: string;
  readonly type: ExtractedFactType;
  readonly confidence: ConfidenceLevel;
  readonly tags: readonly string[];
  readonly rationale?: string;
}

/**
 * Result of enriching a session transcript with LLM extraction.
 */
export interface IEnrichmentResult {
  readonly facts: readonly IExtractedFact[];
  readonly summary: string;
  readonly usage: ILlmUsage;
}

/**
 * Options for transcript enrichment.
 */
export interface IEnrichmentOptions {
  /** Extraction depth: 'fast' extracts top 5 facts, 'thorough' up to 15. Default: 'fast'. */
  readonly depth?: 'fast' | 'thorough';
  /** Restrict extraction to specific fact types. Default: all types. */
  readonly extractTypes?: readonly ExtractedFactType[];
  /** Maximum transcript length sent to LLM (chars). Default: 4000. */
  readonly maxSnippetLength?: number;
}

/**
 * Service for enriching session transcripts with LLM-extracted facts.
 */
export interface ITranscriptEnricher {
  /**
   * Enrich a session transcript with structured facts via LLM analysis.
   *
   * @param workSummary - Parsed work summary from the session
   * @param transcriptSnippet - Raw transcript text snippet
   * @param options - Enrichment options
   * @returns Extracted facts, summary, and usage stats
   */
  enrich(
    workSummary: IWorkSummary,
    transcriptSnippet: string,
    options?: IEnrichmentOptions
  ): Promise<IEnrichmentResult>;
}
