/**
 * Task Type & Context Strategy Types
 *
 * Defines task types for mode-aware retrieval and context strategies
 * that control how memory is searched based on what the user is doing.
 *
 * Task types:
 * - planning: Designing architecture, making decisions, evaluating trade-offs
 * - execution: Implementing features, writing code, building functionality
 * - exploration: Brainstorming, investigating possibilities, research
 * - debugging: Fixing bugs, diagnosing errors, troubleshooting
 */

/**
 * Task type for mode-aware retrieval.
 */
export type TaskType = 'planning' | 'execution' | 'exploration' | 'debugging';

/**
 * All valid task type values.
 */
export const TASK_TYPE_VALUES: readonly TaskType[] = [
  'planning',
  'execution',
  'exploration',
  'debugging',
] as const;

/**
 * Context strategy that controls retrieval behavior per task type.
 */
export interface IContextStrategy {
  /** Memory search types to query (e.g. 'decision', 'retrospective', 'pattern') */
  readonly searchTypes: readonly string[];
  /** Maximum results per search type */
  readonly maxResults: number;
  /** Timeout for memory queries (ms) */
  readonly timeout: number;
  /** Maximum facts to load in session context */
  readonly factLimit: number;
  /** Search breadth: how many topic keywords to use */
  readonly searchBreadth: number;
}

/**
 * Default context strategies per task type.
 */
export const DEFAULT_CONTEXT_STRATEGIES: Readonly<Record<TaskType, IContextStrategy>> = {
  planning: {
    searchTypes: ['decision', 'retrospective', 'pattern', 'task'],
    maxResults: 5,
    timeout: 4000,
    factLimit: 150,
    searchBreadth: 5,
  },
  execution: {
    searchTypes: ['pattern', 'task', 'recent'],
    maxResults: 3,
    timeout: 3000,
    factLimit: 75,
    searchBreadth: 3,
  },
  exploration: {
    searchTypes: ['decision', 'pattern', 'retrospective'],
    maxResults: 5,
    timeout: 3000,
    factLimit: 100,
    searchBreadth: 5,
  },
  debugging: {
    searchTypes: ['bug', 'error', 'gotcha', 'task'],
    maxResults: 5,
    timeout: 4000,
    factLimit: 100,
    searchBreadth: 4,
  },
};

/**
 * Detection signal keywords per task type.
 * Used by TaskTypeDetector for signal-based scoring.
 */
export const DETECTION_SIGNALS: Readonly<Record<TaskType, readonly string[]>> = {
  planning: [
    'design', 'plan', 'architecture', 'should we', 'approach',
    'strategy', 'evaluate', 'compare', 'trade-off', 'tradeoff',
    'propose', 'consider', 'alternatives', 'decision', 'choose',
  ],
  execution: [
    'implement', 'add', 'create', 'build', 'write',
    'update', 'modify', 'change', 'refactor', 'move',
    'rename', 'extract', 'install', 'configure', 'setup',
  ],
  exploration: [
    'what if', 'could we', 'brainstorm', 'explore', 'investigate',
    'research', 'look into', 'try', 'experiment', 'prototype',
    'spike', 'discover', 'understand', 'how does', 'what does',
  ],
  debugging: [
    'bug', 'error', 'failing', 'broken', 'crash',
    'fix', 'debug', 'issue', 'wrong', 'unexpected',
    'not working', 'stack trace', 'exception', 'regression', 'flaky',
  ],
};

/**
 * Check if a string is a valid TaskType value.
 *
 * @param value - The string to check
 * @returns true if valid task type
 */
export function isValidTaskType(value: string): value is TaskType {
  return TASK_TYPE_VALUES.includes(value as TaskType);
}

/**
 * Get the default context strategy for a task type.
 *
 * @param taskType - The task type
 * @returns The default context strategy
 */
export function getDefaultStrategy(taskType: TaskType): IContextStrategy {
  return DEFAULT_CONTEXT_STRATEGIES[taskType];
}
