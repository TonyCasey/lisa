/**
 * Git Extractor Interface
 *
 * Defines the contract for heuristic-based extraction of structured facts
 * from GitHub PR data (descriptions, review comments, linked issues).
 * Complements the LLM-based CommitEnricher with fast, no-cost extraction.
 *
 * Part of LISA-9: Phase 3 Git-Powered Memory Extraction.
 */

import type { ConfidenceLevel } from './types/IMemoryQuality';

/**
 * Fact types that can be extracted via heuristics.
 * Subset of memory types focused on patterns detectable without LLM.
 */
export type HeuristicFactType = 'decision' | 'gotcha' | 'convention';

/**
 * All valid heuristic fact types.
 */
export const HEURISTIC_FACT_TYPE_VALUES: readonly HeuristicFactType[] = [
  'decision',
  'gotcha',
  'convention',
] as const;

/**
 * Type guard for HeuristicFactType.
 */
export function isValidHeuristicFactType(value: string): value is HeuristicFactType {
  return HEURISTIC_FACT_TYPE_VALUES.includes(value as HeuristicFactType);
}

/**
 * Source of the extracted fact.
 */
export type FactSource =
  | 'pr-description'
  | 'review-comment'
  | 'issue-body'
  | 'commit-pattern';

/**
 * All valid fact sources.
 */
export const FACT_SOURCE_VALUES: readonly FactSource[] = [
  'pr-description',
  'review-comment',
  'issue-body',
  'commit-pattern',
] as const;

/**
 * A fact extracted via heuristic pattern matching (no LLM).
 */
export interface IHeuristicFact {
  /** Self-contained description of the fact. */
  readonly text: string;
  /** Type of fact extracted. */
  readonly type: HeuristicFactType;
  /** Source of the extraction. */
  readonly source: FactSource;
  /** Confidence level of the extraction. */
  readonly confidence: ConfidenceLevel;
  /** Relevant tags (file paths, technologies, components). */
  readonly tags: readonly string[];
  /** PR number if sourced from GitHub PR. */
  readonly prNumber?: number;
  /** Issue number if sourced from linked issue. */
  readonly issueNumber?: number;
  /** Commit SHA if sourced from commit pattern. */
  readonly commitSha?: string;
  /** Name of the pattern that matched. */
  readonly matchedPattern?: string;
}

/**
 * Enriched PR data fetched from GitHub API.
 */
export interface IEnrichedPR {
  /** PR number. */
  readonly number: number;
  /** PR title. */
  readonly title: string;
  /** PR description/body. */
  readonly body: string;
  /** PR author login. */
  readonly author: string;
  /** Review comments on the PR. */
  readonly reviewComments: readonly IReviewComment[];
  /** Issues linked to this PR. */
  readonly linkedIssues: readonly ILinkedIssue[];
}

/**
 * A review comment from a PR.
 */
export interface IReviewComment {
  /** Comment ID. */
  readonly id: number;
  /** Comment author login. */
  readonly author: string;
  /** Comment body text. */
  readonly body: string;
  /** File path if this is a line comment. */
  readonly path?: string;
  /** Whether this comment thread is resolved. */
  readonly isResolved: boolean;
}

/**
 * A linked issue from a PR.
 */
export interface ILinkedIssue {
  /** Issue number. */
  readonly number: number;
  /** Issue title. */
  readonly title: string;
  /** Issue body text. */
  readonly body: string;
}

/**
 * Result of heuristic extraction.
 */
export interface IHeuristicExtractionResult {
  /** Extracted facts from all processed PRs. */
  readonly facts: readonly IHeuristicFact[];
  /** Number of PRs that were processed. */
  readonly prsProcessed: number;
  /** Number of PRs that were skipped (already processed or fetch failed). */
  readonly prsSkipped: number;
  /** Number of patterns that matched. */
  readonly patternsMatched: number;
}

/**
 * Options for heuristic extraction.
 */
export interface IHeuristicExtractionOptions {
  /** Maximum PRs to process. Default: 10. */
  readonly maxPRs?: number;
  /** PR numbers to skip (e.g., already processed). */
  readonly skipPRs?: readonly number[];
  /** Restrict extraction to specific fact types. Default: all types. */
  readonly extractTypes?: readonly HeuristicFactType[];
  /** Minimum confidence level to include. Default: 'low'. */
  readonly minConfidence?: ConfidenceLevel;
}

/**
 * Service for heuristic-based fact extraction from GitHub PR data.
 */
export interface IGitExtractor {
  /**
   * Extract facts from PRs linked to high-interest commits.
   *
   * Fetches PR descriptions, review comments, and linked issues,
   * then applies pattern matching to extract decision, gotcha,
   * and convention facts.
   *
   * @param prNumbers - PR numbers to process
   * @param repo - Repository in "owner/repo" format
   * @param options - Extraction options
   * @returns Extracted facts, processing stats
   */
  extractFromPRs(
    prNumbers: readonly number[],
    repo: string,
    options?: IHeuristicExtractionOptions
  ): Promise<IHeuristicExtractionResult>;
}

/**
 * Interface for fetching GitHub PR/issue data.
 * Abstracts the underlying GitHub client for testability.
 */
export interface IGitHubDataFetcher {
  /**
   * Fetch enriched PR data including description, reviews, and linked issues.
   *
   * @param repo - Repository in "owner/repo" format
   * @param prNumber - PR number to fetch
   * @returns Enriched PR data, or null if fetch failed
   */
  fetchPR(repo: string, prNumber: number): Promise<IEnrichedPR | null>;

  /**
   * Check if GitHub API is available.
   */
  isAvailable(): Promise<boolean>;
}
