/**
 * Domain interfaces - contracts with no implementations.
 * These live in the domain layer and have ZERO dependencies.
 */

// Service interfaces
export { ILisaContext } from './ILisaContext';
export { IMemoryReader, IMemoryWriter, IMemoryService, IMemoryDateOptions } from './IMemoryService';
export { ITaskReader, ITaskWriter, ITaskService } from './ITaskService';
export { IMcpClient } from './IMcpClient';
export { ISessionCaptureService } from './ISessionCaptureService';
export { EventHandler, IEventEmitter } from './IEventEmitter';
export { ILisaServices } from './ILisaServices';
export { IRecursionResult, IRecursionConfig, IRecursionService } from './IRecursionService';
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

// Event interfaces
export * from './events';

// Type interfaces (data structures)
export * from './types';
