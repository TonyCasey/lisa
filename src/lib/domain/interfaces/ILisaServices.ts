import type { ILisaContext } from './ILisaContext';
import type { IMemoryService } from './IMemoryService';
import type { ITaskService } from './ITaskService';
import type { ISessionCaptureService } from './ISessionCaptureService';
import type { IEventEmitter } from './IEventEmitter';
import type { IRecursionService } from './IRecursionService';
import type { ILogger } from './ILogger';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';

/**
 * Service container for dependency injection.
 * All services are readonly to prevent reassignment.
 */
export interface ILisaServices {
  readonly context: ILisaContext;
  readonly memory: IMemoryService;
  readonly tasks: ITaskService;
  readonly events: IEventEmitter;
  readonly sessionCapture: ISessionCaptureService;
  readonly logger: ILogger;

  /**
   * Recursion service for plan mode memory search.
   * Optional - may be undefined if not needed.
   */
  readonly recursion?: IRecursionService;

  /**
   * GitHub sync service for syncing tasks with GitHub Issues.
   * Optional - may be undefined if GitHub integration is not configured.
   */
  readonly githubSync?: IGitHubSyncService;
}
