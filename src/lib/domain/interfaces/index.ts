/**
 * Domain interfaces - contracts with no implementations.
 * These live in the domain layer and have ZERO dependencies.
 */

// Service interfaces
export { ILisaContext } from './ILisaContext';
export { IMemoryReader, IMemoryWriter, IMemoryService, IMemoryDateOptions, IMemoryRelationshipWriter, IMemoryServiceWithRelationships, IMemoryQualityReader, IMemoryServiceWithQuality } from './IMemoryService';
export type { IMemorySaveOptions } from './dal/IMemoryRepository';
export { ITaskReader, ITaskWriter, ITaskService } from './ITaskService';
export { IMcpClient } from './IMcpClient';
export { ISessionCaptureService } from './ISessionCaptureService';
export { EventHandler, IEventEmitter } from './IEventEmitter';
export { ILisaServices } from './ILisaServices';
export { IRecursionResult, IRecursionConfig, IRecursionService } from './IRecursionService';
export { ITaskTypeResult, ITaskTypeDetector } from './ITaskTypeDetector';
export { LogLevel, ILoggerOptions, ILogger, LoggerFactory } from './ILogger';
export {
  LogEvents,
  LogEvent,
  ILogContext,
  IStructuredLog,
  IStructuredLogger,
  generateCorrelationId,
  deriveCompleteEvent,
  deriveErrorEvent,
} from './IStructuredLog';
export {
  ILabelInferenceResult,
  ILabelInferenceOptions,
  ILabelInferenceService,
  ILabelRule,
} from './ILabelInference';
export {
  NotificationType,
  NotificationPriority,
  INotification,
  INotificationResult,
  INotificationOptions,
  INotificationService,
} from './INotificationService';
export {
  CronPlatform,
  CronStatus,
  ICronJobConfig,
  ICronConfig,
  ILisaGlobalConfig,
  ICronResult,
  ICronService,
} from './ICronService';
export type {
  IGitClient,
  IGitLogOptions,
  IGitDiffOptions,
  IGitLogDetailedOptions,
  IGitLogCommit,
  IGitCommitStatEntry,
  IGitTag,
} from './IGitClient';
export type {
  IGitTriageService,
  IGitCommitData,
  IGitCommitStats,
  ICommitInterestSignals,
  IScoredCommit,
  ITriageResult,
  ITriageOptions,
  IFileHotspot,
  ITagInfo,
} from './IGitTriageService';
export type { IClaudeCliClient, IClaudePromptOptions } from './IClaudeCliClient';
export {
  type DuplicateReason,
  type IDuplicateGroup,
  type IDeduplicationResult,
  type IDeduplicationOptions,
  type IDeduplicationService,
} from './IDeduplicationService';
export {
  type CurationMark,
  CURATION_MARK_VALUES,
  type ICurationService,
  isValidCurationMark,
  resolveCurationTag,
  parseCurationTag,
} from './ICurationService';
export {
  type ConsolidationAction,
  CONSOLIDATION_ACTION_VALUES,
  type IConsolidationResult,
  type IConsolidationOptions,
  type IConsolidationService,
} from './IConsolidationService';
export {
  type IPreference,
  type IPreferenceStore,
} from './IPreferenceStore';
export {
  type LlmProvider,
  LLM_PROVIDER_VALUES,
  isValidLlmProvider,
  getDefaultLlmConfig,
  type ILlmConfig,
  type ILlmUsage,
  type ILlmResponse,
  type ILlmRequestOptions,
  type ILlmService,
} from './ILlmService';
export {
  type ILlmConfigService,
} from './ILlmConfigService';
export {
  type LlmFeature,
  LLM_FEATURE_VALUES,
  isValidLlmFeature,
  type ILlmUsageRecord,
  type ILlmUsageTracker,
} from './ILlmUsageTracker';
export {
  type ILlmGuard,
} from './ILlmGuard';
export {
  type ISummarizationResult,
  type ISummarizationOptions,
  type ISummarizationService,
} from './ISummarizationService';
export {
  type ExtractedFactType,
  EXTRACTED_FACT_TYPE_VALUES,
  isValidExtractedFactType,
  type IExtractedFact,
  type IEnrichmentResult,
  type IEnrichmentOptions,
  type ITranscriptEnricher,
} from './ITranscriptEnricher';
export {
  type CommitFactType,
  COMMIT_FACT_TYPE_VALUES,
  isValidCommitFactType,
  type ICommitFact,
  type ICommitEnrichmentResult,
  type ICommitEnrichmentOptions,
  type ICommitEnricher,
} from './ICommitEnricher';
export {
  type HeuristicFactType,
  HEURISTIC_FACT_TYPE_VALUES,
  isValidHeuristicFactType,
  type FactSource,
  FACT_SOURCE_VALUES,
  type IHeuristicFact,
  type IEnrichedPR,
  type IReviewComment,
  type ILinkedIssue,
  type IHeuristicExtractionResult,
  type IHeuristicExtractionOptions,
  type IGitExtractor,
  type IGitHubDataFetcher,
} from './IGitExtractor';
export {
  type IWorkSummary,
  type IDetectedDecision,
  type IDetectedError,
  type IFilePromptCorrelation,
} from './IWorkSummary';
export {
  type NlCurationIntent,
  NL_CURATION_INTENT_VALUES,
  isValidNlCurationIntent,
  type INlOperation,
  type INlCurationPlan,
  type INlCurationResult,
  type INlCurationService,
} from './INlCurationService';

// Event interfaces
export * from './events';

// Type interfaces (data structures)
export * from './types';
