/**
 * Shared service implementations for skill scripts.
 */

// Re-export interfaces
export * from './interfaces';

// Core data services
export { createTaskService, type ITaskServiceDependencies } from './TaskService';
export { createMemoryService, type IMemoryServiceDependencies } from './MemoryService';

// CLI services
export {
  createTaskCliService,
  type ITaskCliService,
  type ITaskCliDependencies,
  type ITaskCliArgs,
} from './TaskCliService';
export {
  createMemoryCliService,
  type IMemoryCliService,
  type IMemoryCliDependencies,
  type IMemoryCliArgs,
} from './MemoryCliService';

// Domain services
export {
  createJiraClient,
  loadJiraConfig,
  type IJiraClient,
  type IJiraConfig,
  type ICreateIssueArgs,
  type IListIssuesArgs,
  type IAssignIssueArgs,
  type ITransitionIssueArgs,
  type IChangeTypeArgs,
} from './JiraService';
export {
  createVersionService,
  type IVersionService,
  type IBumpResult,
  type BumpType,
} from './VersionService';
export {
  createStorageService,
  type IStorageService,
  type IStorageStatus,
  type IStorageSwitchResult,
  type StorageMode,
} from './StorageService';
export {
  createSkillCompilerService,
  type ISkillCompilerService,
  type ICompileResult,
  type IMergeResult,
} from './SkillCompilerService';
export {
  createPromptService,
  type IPromptService,
  type IPromptArgs,
  type IPromptResult,
} from './PromptService';
export {
  createInitReviewService,
  type IInitReviewService,
  type IInitReviewResult,
  type ICodebaseInfo,
  type IMarkerInfo,
} from './InitReviewService';
