/**
 * Core module exports
 *
 * Re-exports all core types and functions for clean imports.
 */

// Types
export type {
  // Memory types
  IMemoryItem,
  IMemoryResult,
  IMemoryLoadOptions,
  IMemoryLoadResult,
  IMemoryGroup,
  // Task types
  ITask,
  ITaskCounts,
  ITaskSummary,
  // Session types
  SessionTrigger,
  ISessionStartInput,
  ISessionStopInput,
  IPromptSubmitInput,
  ISessionContext,
  // Work capture types
  IWorkSummary,
  IComplexityRating,
  // Output types
  ISessionStartOutput,
  IGraphitiResult,
} from './types';

// Task loader functions
export {
  // Tag extractors
  getTaskId,
  getTaskNum,
  getTaskStatus,
  getBlockedBy,
  // Utilities
  pickLatest,
  memoryItemToTask,
  deduplicateTasks,
  // Processing
  createTaskCounts,
  countTasksByStatus,
  sortTasksByDate,
  filterTasksByStatus,
  processTasks,
  // Formatting
  formatTaskCountsSummary,
  formatTask,
  formatTaskList,
} from './task-loader';

// Memory loader functions
export {
  // Configuration
  DEFAULT_MEMORY_TIMEOUT_MS,
  MAX_FACTS_PER_QUERY,
  MAX_NODES_PER_QUERY,
  MAX_TASKS,
  // Helpers
  extractFacts,
  extractNodes,
  getMemoryKey,
  deduplicateMemories,
  // Individual loaders
  loadInitReview,
  loadRecentFacts,
  loadNodes,
  loadTasks,
  // Main loader
  loadMemoryWithTimeout,
  // Script-based loaders
  loadMemoryViaScript,
  loadRetrospectiveViaScript,
} from './memory-loader';

// Rules loader functions
export type { IRuleSummary, IRulesLoadOptions } from './rules-loader';
export {
  // Configuration
  DEFAULT_RULES_DIR,
  RULE_CATEGORIES,
  MAX_TOPICS_PER_FILE,
  // Parsing
  extractTitle,
  extractH2Headings,
  parseRuleFile,
  // Loading
  listMarkdownFiles,
  loadCategoryRules,
  loadRules,
  // Formatting
  formatRuleSummary,
  loadRulesSummary,
  // Utilities
  hasRulesDir,
  getRulesCount,
} from './rules-loader';
