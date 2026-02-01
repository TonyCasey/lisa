/**
 * Work Summary Interface.
 *
 * Represents a parsed summary of work performed during a coding session.
 * Used by both the session capture service (infrastructure) and the
 * transcript enricher (domain contract).
 *
 * Lives in the domain layer so that domain interfaces (ITranscriptEnricher)
 * can reference it without crossing the architecture boundary.
 */

import type { TaskType } from './types/ITaskType';

/**
 * A detected user decision from transcript analysis.
 */
export interface IDetectedDecision {
  /** What was decided */
  readonly text: string;
  /** The confirming user message */
  readonly userMessage: string;
  /** Confidence score (0.0-1.0) based on pattern strength */
  readonly confidence: number;
}

/**
 * A detected error from transcript analysis.
 */
export interface IDetectedError {
  /** Error description */
  readonly text: string;
  /** Classification of the error type */
  readonly errorType: 'stack-trace' | 'tool-failure' | 'retry-pattern';
  /** Surrounding message context */
  readonly context?: string;
}

/**
 * Correlation between a file change and the user prompt that triggered it.
 */
export interface IFilePromptCorrelation {
  /** The modified/created file path */
  readonly filePath: string;
  /** The prompt text snippet that triggered the change */
  readonly triggerSnippet: string;
}

/**
 * Parsed work summary from a session transcript.
 */
export interface IWorkSummary {
  readonly messageCount: number;
  readonly userPrompts: number;
  readonly assistantResponses: number;
  readonly toolCalls: number;
  readonly filesCreated: readonly string[];
  readonly filesModified: readonly string[];
  readonly duration: number;
  readonly summary: string;

  /** Heuristic-detected user decisions (optional, populated by heuristic extractors) */
  readonly detectedDecisions?: readonly IDetectedDecision[];
  /** Heuristic-detected errors (optional, populated by heuristic extractors) */
  readonly detectedErrors?: readonly IDetectedError[];
  /** File-prompt correlations (optional, populated by heuristic extractors) */
  readonly filePromptCorrelations?: readonly IFilePromptCorrelation[];
  /** Detected task type from signal analysis (optional) */
  readonly detectedTaskType?: TaskType;
}
