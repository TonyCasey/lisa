/**
 * Git Indexing Service Interface
 *
 * Defines the contract for saving extracted git facts to memory with
 * appropriate quality tags, lifecycle metadata, and deduplication.
 *
 * Part of LISA-10: Phase 4 Indexing.
 */

import type { IHeuristicFact } from './IGitExtractor';

/**
 * Conventional commit types that can be mapped to memory types.
 */
export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'chore'
  | 'style'
  | 'perf'
  | 'ci'
  | 'build';

/**
 * Memory types derived from conventional commit types.
 */
export type GitMemoryType = 'milestone' | 'gotcha' | 'decision' | 'convention';

/**
 * All valid conventional commit types.
 */
export const CONVENTIONAL_COMMIT_TYPES: readonly ConventionalCommitType[] = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'style',
  'perf',
  'ci',
  'build',
] as const;

/**
 * Mapping from conventional commit types to memory types.
 * Returns null for types that should be skipped (e.g., chore).
 */
export const COMMIT_TYPE_TO_MEMORY_TYPE: Readonly<Record<ConventionalCommitType, GitMemoryType | null>> = {
  feat: 'milestone',
  fix: 'gotcha',
  refactor: 'decision',
  docs: 'convention',
  test: 'convention',
  chore: null,  // Skip
  style: null,  // Skip
  perf: 'decision',
  ci: null,     // Skip
  build: null,  // Skip
};

/**
 * Options for indexing git facts.
 */
export interface IGitIndexingOptions {
  /** Conventional commit type for memory type mapping. */
  readonly conventionalType?: ConventionalCommitType;
  /** Skip deduplication check. Default: false. */
  readonly skipDeduplication?: boolean;
  /** Similarity threshold for deduplication (0-1). Default: 0.85. */
  readonly similarityThreshold?: number;
}

/**
 * Result of git fact indexing.
 */
export interface IGitIndexingResult {
  /** Number of facts successfully indexed. */
  readonly indexed: number;
  /** Number of facts skipped (e.g., chore type). */
  readonly skipped: number;
  /** Number of duplicate facts not re-indexed. */
  readonly duplicates: number;
}

/**
 * Service for indexing extracted git facts to memory.
 */
export interface IGitIndexingService {
  /**
   * Index extracted facts to memory with quality tags and deduplication.
   *
   * Applies:
   * - Quality defaults: source:code-analysis, confidence from fact, lifecycle:project
   * - Memory type mapping based on conventional commit type
   * - Deduplication against existing memories
   *
   * @param facts - Facts extracted from git history
   * @param groupId - Memory group ID to save to
   * @param options - Indexing options
   * @returns Indexing result with counts
   */
  indexFacts(
    facts: readonly IHeuristicFact[],
    groupId: string,
    options?: IGitIndexingOptions
  ): Promise<IGitIndexingResult>;
}
