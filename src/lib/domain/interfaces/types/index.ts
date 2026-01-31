/**
 * Type interfaces (data structures).
 */

export { IMemoryItem, IMemoryResult, IMemoryResultBuilder, emptyMemoryResult, createMemoryResultBuilder } from './IMemoryResult';
export { TaskStatus, ITask, ITaskInput, ITaskUpdate, ITaskCounts, emptyTaskCounts } from './ITask';
export { ICapturedWork, emptyCapturedWork } from './ICapturedWork';
export {
  PullRequestStatus,
  CheckStatus,
  CommentStatus,
  IGitHubIssue,
  IPullRequest,
  IPrCheck,
  IPrComment,
  IPullRequestInput,
  IGitHubIssueInput,
  IPullRequestWithRelations,
  createPullRequest,
  createGitHubIssue,
} from './IPullRequest';
export {
  MemoryLifecycle,
  LIFECYCLE_VALUES,
  LIFECYCLE_DEFAULTS,
  resolveLifecycleTag,
  parseLifecycleTag,
  isValidLifecycle,
  computeExpiresAt,
} from './IMemoryLifecycle';
export {
  ConfidenceLevel,
  CONFIDENCE_VALUES,
  CONFIDENCE_SCORES,
  SourceType,
  SOURCE_VALUES,
  DEFAULT_CONFIDENCE,
  resolveConfidenceTag,
  parseConfidenceTag,
  isValidConfidence,
  confidenceToScore,
  scoreToConfidence,
  resolveSourceTag,
  parseSourceTag,
  isValidSource,
  defaultConfidenceForSource,
} from './IMemoryQuality';
