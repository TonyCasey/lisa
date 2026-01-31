/**
 * Task Type Detector Interface
 *
 * Contract for detecting the task type from user prompts.
 * Used by PromptSubmitHandler to determine retrieval strategy.
 */

import type { TaskType } from './types/ITaskType';

/**
 * Result of task type detection.
 */
export interface ITaskTypeResult {
  /** The detected task type */
  readonly taskType: TaskType;
  /** Confidence score (0.0 - 1.0) */
  readonly confidence: number;
  /** Signal keywords that contributed to detection */
  readonly signals: readonly string[];
}

/**
 * Service for detecting task type from user prompts.
 *
 * Uses signal-based scoring (keywords + phrases) for fast,
 * deterministic classification without LLM calls.
 */
export interface ITaskTypeDetector {
  /**
   * Detect the task type from a user prompt.
   *
   * @param prompt - The user's prompt text
   * @returns Detection result with task type, confidence, and signals
   */
  detect(prompt: string): ITaskTypeResult;
}
