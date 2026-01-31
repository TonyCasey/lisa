/**
 * TaskTypeDetector
 *
 * Signal-based task type detection from user prompts.
 * Uses keyword/phrase scoring for fast, deterministic classification
 * without LLM calls.
 */

import type { ITaskTypeDetector, ITaskTypeResult } from '../../domain/interfaces/ITaskTypeDetector';
import type { TaskType } from '../../domain/interfaces/types/ITaskType';
import { TASK_TYPE_VALUES, DETECTION_SIGNALS } from '../../domain/interfaces/types/ITaskType';

/**
 * Minimum confidence threshold. Below this, default to 'execution'.
 */
const MIN_CONFIDENCE_THRESHOLD = 0.15;

/**
 * Bonus multiplier for multi-word phrase matches (more specific signal).
 */
const PHRASE_BONUS = 2;

/**
 * Concrete implementation of ITaskTypeDetector.
 *
 * Scores each task type by counting keyword/phrase matches from
 * DETECTION_SIGNALS. Multi-word phrases are weighted higher.
 * Returns the highest-scoring type with confidence and matched signals.
 */
export class TaskTypeDetector implements ITaskTypeDetector {
  /**
   * Detect the task type from a user prompt.
   */
  detect(prompt: string): ITaskTypeResult {
    if (!prompt || prompt.trim().length === 0) {
      return { taskType: 'execution', confidence: 0, signals: [] };
    }

    const normalised = prompt.toLowerCase();

    let bestType: TaskType = 'execution';
    let bestScore = 0;
    let bestSignals: string[] = [];
    let totalScore = 0;

    for (const taskType of TASK_TYPE_VALUES) {
      const signals = DETECTION_SIGNALS[taskType];
      let score = 0;
      const matched: string[] = [];

      for (const signal of signals) {
        if (normalised.includes(signal)) {
          const isPhrase = signal.includes(' ');
          const weight = isPhrase ? PHRASE_BONUS : 1;
          score += weight;
          matched.push(signal);
        }
      }

      totalScore += score;

      if (score > bestScore) {
        bestScore = score;
        bestType = taskType;
        bestSignals = matched;
      }
    }

    // Compute confidence as proportion of winning score to total
    const confidence = totalScore > 0
      ? Math.min(bestScore / Math.max(totalScore, bestScore + 1), 1.0)
      : 0;

    // Below threshold, default to execution
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      return { taskType: 'execution', confidence, signals: bestSignals };
    }

    return {
      taskType: bestType,
      confidence: Math.round(confidence * 100) / 100,
      signals: bestSignals,
    };
  }
}
