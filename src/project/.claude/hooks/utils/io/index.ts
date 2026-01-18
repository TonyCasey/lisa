/**
 * I/O module exports
 *
 * Re-exports all I/O functions for clean imports.
 */

// Stdin Reader
export type { IStdinReaderOptions } from './stdin-reader';
export {
  readJsonStdin,
  readRawStdin,
  hasStdinData,
} from './stdin-reader';

// Output Formatter
export type { ISessionStartFormatOptions } from './output-formatter';
export {
  // Configuration
  RECENT_HOURS,
  MAX_RECENT_MEMORIES,
  GROUP_WINDOW_MINUTES,
  EXCLUDED_RELATIONSHIPS,
  // Date formatting
  formatRelativeDate,
  // Memory filtering & grouping
  filterRecentMemories,
  extractGroupSummary,
  groupMemoriesByTime,
  formatMemorySummary,
  // Session output
  formatSessionStartLines,
  formatUserSummary,
} from './output-formatter';

// Graphiti Writer
export type {
  IMemoryWriteOptions,
  IPromptWriteOptions,
} from './graphiti-writer';
export {
  // Configuration
  DEFAULT_TIMEOUT_MS,
  ASYNC_TIMEOUT_MS,
  DEFAULT_ENDPOINT,
  // Path helpers
  getMemorySkillPath,
  getPromptSkillPath,
  skillExists,
  // Availability
  isGraphitiAvailable,
  getGraphitiEndpoint,
  // Memory writing
  writeMemory,
  writeMemoryAsync,
  // Prompt writing
  writePrompt,
  writePromptAsync,
} from './graphiti-writer';
