/**
 * Shared service implementations for skill scripts.
 *
 * Core data services (MemoryService, TaskService, PromptService) are now
 * consolidated in infrastructure. This file re-exports them for backwards
 * compatibility with existing skill entry points.
 */

// Re-export interfaces from infrastructure
export * from '../../../infrastructure/services/skill-interfaces';

// Core data services (re-exported from infrastructure)
export {
  createSkillTaskService as createTaskService,
  type ISkillTaskServiceDependencies as ITaskServiceDependencies,
} from '../../../infrastructure/services/SkillTaskService';
export {
  createSkillMemoryService as createMemoryService,
  type ISkillMemoryServiceDependencies as IMemoryServiceDependencies,
} from '../../../infrastructure/services/SkillMemoryService';
export {
  createSkillPromptService as createPromptService,
  type ISkillPromptServiceDependencies as IPromptServiceDependencies,
} from '../../../infrastructure/services/SkillPromptService';

// CLI services
export {
  createTaskCliService,
  type ITaskCliService,
  type ITaskCliDependencies,
  type ITaskCliArgs,
} from './TaskCliService';
export {
  createMemoryCliService,
  parseTtlDuration,
  type IMemoryCliService,
  type IMemoryCliDependencies,
  type IMemoryCliArgs,
  type MemoryCliResult,
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
// PromptService is now re-exported from infrastructure (see above)
export {
  createInitReviewService,
  type IInitReviewService,
  type IInitReviewResult,
  type ICodebaseInfo,
  type IMarkerInfo,
} from './InitReviewService';
export {
  createGitHubClient,
  type IGitHubClient,
  type IGitHubIssue,
  type IGitHubProject,
  type IGitHubProjectField,
  type IGitHubProjectItem,
  type ICreateIssueArgs as IGitHubCreateIssueArgs,
  type IListIssuesArgs as IGitHubListIssuesArgs,
  type IViewIssueArgs as IGitHubViewIssueArgs,
  type ICloseIssueArgs as IGitHubCloseIssueArgs,
  type IReopenIssueArgs as IGitHubReopenIssueArgs,
  type IAssignIssueArgs as IGitHubAssignIssueArgs,
  type ILabelIssueArgs as IGitHubLabelIssueArgs,
  type IListProjectsArgs as IGitHubListProjectsArgs,
  type IGetProjectArgs as IGitHubGetProjectArgs,
  type IGetProjectItemsArgs as IGitHubGetProjectItemsArgs,
  type IGetProjectFieldsArgs as IGitHubGetProjectFieldsArgs,
  type IAddToProjectArgs as IGitHubAddToProjectArgs,
  type ISetProjectFieldArgs as IGitHubSetProjectFieldArgs,
} from './GitHubService';
export {
  createGitHubSyncService,
  lisaStatusToGitHub,
  gitHubStatusToLisa,
  type IGitHubSyncService,
  type IGitHubSyncServiceDependencies,
  type ISyncOptions,
  type ISyncResult,
  type ISyncConflict,
  type ISyncItem,
  type SyncDirection,
  type LisaTaskStatus,
} from './GitHubSyncService';
