/**
 * Commit Enricher Interface.
 *
 * Defines the contract for LLM-powered extraction of structured facts
 * from git commits. Extracts features, decisions, refactors, migrations,
 * bug fixes, breaking changes, conventions, and dependency updates.
 *
 * Part of LISA-8: Phase 2 Git-Powered Memory Enrichment.
 */

import type { ILlmUsage } from './ILlmService';
import type { ConfidenceLevel } from './types/IMemoryQuality';
import type { IScoredCommit } from './IGitTriageService';

/**
 * Fact type extracted from a commit.
 */
export type CommitFactType =
  | 'feature'
  | 'decision'
  | 'refactor'
  | 'migration'
  | 'bugfix'
  | 'breaking-change'
  | 'convention'
  | 'dependency';

/**
 * All valid commit fact types.
 */
export const COMMIT_FACT_TYPE_VALUES: readonly CommitFactType[] = [
  'feature',
  'decision',
  'refactor',
  'migration',
  'bugfix',
  'breaking-change',
  'convention',
  'dependency',
] as const;

/**
 * Type guard for CommitFactType.
 */
export function isValidCommitFactType(value: string): value is CommitFactType {
  return COMMIT_FACT_TYPE_VALUES.includes(value as CommitFactType);
}

/**
 * A structured fact extracted by the LLM from a commit.
 */
export interface ICommitFact {
  /** Self-contained description of the fact. */
  readonly text: string;
  /** Type of fact extracted. */
  readonly type: CommitFactType;
  /** Confidence level of the extraction. */
  readonly confidence: ConfidenceLevel;
  /** Relevant tags (file paths, technologies, components). */
  readonly tags: readonly string[];
  /** Short SHA of the source commit. */
  readonly commitSha: string;
  /** Optional rationale explaining why this fact is worth remembering. */
  readonly rationale?: string;
}

/**
 * Result of enriching commits with LLM extraction.
 */
export interface ICommitEnrichmentResult {
  /** Extracted facts from all processed commits. */
  readonly facts: readonly ICommitFact[];
  /** Number of commits that were processed. */
  readonly commitsProcessed: number;
  /** Number of commits that were skipped (already enriched or filtered). */
  readonly commitsSkipped: number;
  /** LLM usage statistics. */
  readonly usage: ILlmUsage;
}

/**
 * Options for commit enrichment.
 */
export interface ICommitEnrichmentOptions {
  /** Maximum commits to process in one batch. Default: 5. */
  readonly maxCommits?: number;
  /** Commit SHAs to skip (e.g., already enriched). */
  readonly skipShas?: readonly string[];
  /** Restrict extraction to specific fact types. Default: all types. */
  readonly extractTypes?: readonly CommitFactType[];
  /** Maximum tokens to use for the LLM call. Default: 4096. */
  readonly maxTokens?: number;
}

/**
 * Service for enriching commits with LLM-extracted facts.
 */
export interface ICommitEnricher {
  /**
   * Enrich high-interest commits with structured facts via LLM analysis.
   *
   * @param commits - High-interest commits from triage
   * @param options - Enrichment options
   * @returns Extracted facts, processing stats, and usage
   */
  enrich(
    commits: readonly IScoredCommit[],
    options?: ICommitEnrichmentOptions
  ): Promise<ICommitEnrichmentResult>;
}
