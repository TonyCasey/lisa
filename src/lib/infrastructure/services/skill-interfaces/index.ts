/**
 * Skill service interfaces.
 *
 * These are the "rich" interfaces used by CLI skill scripts,
 * with full capabilities like dedupe, curate, external linking, etc.
 *
 * Contrast with domain/interfaces which has simpler infrastructure interfaces.
 */

export type {
  // Memory types
  IFact,
  MemoryMode,
  IMemoryLoadResult,
  IMemoryAddResult,
  IMemoryAddOptions,
  IMemoryLoadOptions,
  IMemoryExpireResult,
  IMemoryCleanupResult,
  IConflictGroup,
  IMemoryConflictsResult,
  IDuplicateGroup,
  IMemoryDedupeResult,
  IMemoryCurateResult,
  IMemoryConsolidateResult,
  ISkillMemoryService,
} from './ISkillMemoryService';

export type {
  // Task types
  TaskMode,
  ExternalLinkSource,
  ITaskExternalLink,
  ISkillTask,
  ITaskListResult,
  ITaskWriteResult,
  ITaskWriteOptions,
  ITaskLoadOptions,
  ITaskLinkResult,
  ISkillTaskService,
} from './ISkillTaskService';

export type {
  // Prompt types
  IPromptArgs,
  IPromptResult,
  ISkillPromptService,
} from './ISkillPromptService';

// Re-export with legacy names for backwards compatibility
export type { ISkillMemoryService as IMemoryService } from './ISkillMemoryService';
export type { ISkillTaskService as ITaskService } from './ISkillTaskService';
export type { ISkillTask as ITask } from './ISkillTaskService';
export type { ISkillPromptService as IPromptService } from './ISkillPromptService';
