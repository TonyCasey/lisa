import type { ILisaContext } from './ILisaContext';
import type { IMemoryService } from './IMemoryService';
import type { ITaskService } from './ITaskService';
import type { IMcpClient } from './IMcpClient';
import type { ISessionCaptureService } from './ISessionCaptureService';
import type { IEventEmitter } from './IEventEmitter';
import type { IRepositoryRouter } from './dal';
import type { IRecursionService } from './IRecursionService';
import type { ILogger } from './ILogger';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';
import type { ICommitEnricher } from './ICommitEnricher';
import type { IGitExtractor } from './IGitExtractor';

/**
 * Service container for dependency injection.
 * All services are readonly to prevent reassignment.
 */
export interface ILisaServices {
  readonly context: ILisaContext;
  readonly memory: IMemoryService;
  readonly tasks: ITaskService;
  readonly mcp: IMcpClient;
  readonly events: IEventEmitter;
  readonly sessionCapture: ISessionCaptureService;
  readonly logger: ILogger;
  
  /**
   * Repository router for DAL operations.
   * Routes to optimal backend (Neo4j, MCP, Zep) based on operation type.
   * Optional - may be undefined if DAL initialization fails.
   */
  readonly router?: IRepositoryRouter;

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

  /**
   * Commit enricher for extracting facts from high-interest commits.
   * Optional - may be undefined if LLM integration is not configured.
   */
  readonly commitEnricher?: ICommitEnricher;

  /**
   * Git extractor for heuristic-based fact extraction from PRs.
   * Optional - may be undefined if GitHub integration is not configured.
   */
  readonly gitExtractor?: IGitExtractor;
}
