/**
 * Domain interfaces - contracts with no implementations.
 * These live in the domain layer and have ZERO dependencies.
 */

// Service interfaces
export { ILisaContext } from './ILisaContext';
export { IMemoryReader, IMemoryWriter, IMemoryService, IMemoryDateOptions, IMemoryRelationshipWriter, IMemoryServiceWithRelationships } from './IMemoryService';
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
export type { IGitClient, IGitLogOptions, IGitDiffOptions } from './IGitClient';
export type { IClaudeCliClient, IClaudePromptOptions } from './IClaudeCliClient';

// Event interfaces
export * from './events';

// Type interfaces (data structures)
export * from './types';

// Re-export project context types at top level for convenience
export type { IProjectContext, IProjectContextUpdates, IProjectContextService } from './types/IProjectContext';

// Compaction service
export type {
  ICompactionSummary,
  ICompactionResult,
  ICompactionOptions,
  ICompactionService,
} from './ICompactionService';
