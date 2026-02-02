import type { ITaskTypeDetector, ITaskTypeResult } from '../../domain/interfaces/ITaskTypeDetector';
import type { TaskType } from '../../domain/interfaces/types/ITaskType';
import { DETECTION_SIGNALS } from '../../domain/interfaces/types/ITaskType';

/**
 * Default task type when no strong signals are detected.
 */
const DEFAULT_TASK_TYPE: TaskType = 'execution';

/**
 * Signal-based task type detector.
 *
 * Scores each task type by counting matching signal keywords in the prompt.
 * Uses word-level matching for single-word signals to avoid substring false
 * positives (e.g., "plan" in "plant"), and substring matching for multi-word
 * phrases. Confidence = matched signals / total signals for the winning type.
 * Defaults to 'execution' when no strong signals are found.
 */
export class TaskTypeDetector implements ITaskTypeDetector {
  /**
   * Detect the task type from a user prompt.
   */
  detect(prompt: string): ITaskTypeResult {
    if (!prompt || prompt.trim().length === 0) {
      return { taskType: DEFAULT_TASK_TYPE, confidence: 0, signals: [] };
    }

    const textLower = prompt.toLowerCase();
    const words = textLower.split(/\s+/).filter(w => w.length > 0);
    // Build word set with punctuation stripped for word-level matching
    const wordSet = new Set(
      words.map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 0)
    );

    if (words.length === 0) {
      return { taskType: DEFAULT_TASK_TYPE, confidence: 0, signals: [] };
    }

    const scores: Record<TaskType, number> = {
      planning: 0,
      execution: 0,
      exploration: 0,
      debugging: 0,
    };

    const matchedSignals: Record<TaskType, string[]> = {
      planning: [],
      execution: [],
      exploration: [],
      debugging: [],
    };

    for (const [taskType, signals] of Object.entries(DETECTION_SIGNALS)) {
      for (const signal of signals) {
        const signalLower = signal.toLowerCase();
        // Use word-level match for single words, substring match for phrases
        const matched = signalLower.includes(' ')
          ? textLower.includes(signalLower)
          : wordSet.has(signalLower);
        if (matched) {
          scores[taskType as TaskType]++;
          matchedSignals[taskType as TaskType].push(signal);
        }
      }
    }

    // Find dominant type
    let maxScore = 0;
    let dominant: TaskType = DEFAULT_TASK_TYPE;
    for (const [taskType, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        dominant = taskType as TaskType;
      }
    }

    // No signals found — default to execution with 0 confidence
    if (maxScore === 0) {
      return { taskType: DEFAULT_TASK_TYPE, confidence: 0, signals: [] };
    }

    // Confidence = coverage of winning type's signals, capped at 1.0
    const bestPossibleScore = DETECTION_SIGNALS[dominant]?.length ?? 0;
    const confidence = bestPossibleScore === 0 ? 0 : Math.min(maxScore / bestPossibleScore, 1.0);

    return {
      taskType: dominant,
      confidence,
      signals: matchedSignals[dominant],
    };
  }
}

/**
 * Factory function for creating a TaskTypeDetector.
 */
export function createTaskTypeDetector(): ITaskTypeDetector {
  return new TaskTypeDetector();
}
