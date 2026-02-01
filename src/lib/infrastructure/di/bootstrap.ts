/**
 * Container Bootstrap.
 *
 * Configures and initializes the DI container with all service registrations.
 * This is the composition root where all dependencies are wired together.
 */

import type { IContainer } from './IContainer';
import type { IServiceConfig } from './ServiceFactory';
import type {
  ILogger,
  ILisaContext,
  IMemoryService,
  ITaskService,
  IMcpClient,
  ISessionCaptureService,
  IEventEmitter,
  IRecursionService,
  IPreferenceStore,
} from '../../domain/interfaces';
import type { ILlmConfigService } from '../../domain/interfaces/ILlmConfigService';
import type { ILlmService } from '../../domain/interfaces/ILlmService';
import type { ILlmUsageTracker } from '../../domain/interfaces/ILlmUsageTracker';
import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ITranscriptEnricher } from '../../domain/interfaces/ITranscriptEnricher';
import type { ITaskTypeDetector } from '../../domain/interfaces/ITaskTypeDetector';
import type { IMemoryServiceWithQuality } from '../../domain/interfaces/IMemoryService';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import type { IConnectionManagers } from '../dal';
import type { IRequestHandler } from '../../application/mediator';
import type { ISessionStartResult } from '../../application/interfaces';
import type {
  SessionStartRequest,
  SessionStopRequest,
  PromptSubmitRequest,
  ISessionStopResult,
  IPromptSubmitResult,
} from '../../application/mediator/requests';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';

import { createContainer } from './Container';
import { TOKENS } from './tokens';

import { ContextDetector } from '../context';
import { McpClient } from '../mcp';
import {
  MemoryService,
  TaskService,
  EventEmitter,
  SessionCaptureService,
  RecursionService,
} from '../services';
import { createDeduplicationService } from '../services/DeduplicationService';
import { createCurationService } from '../services/CurationService';
import { createConsolidationService } from '../services/ConsolidationService';
import { createPreferenceStore } from '../services/PreferenceStore';
import { createLlmConfigService } from '../services/LlmConfigService';
import { createLlmService } from '../services/LlmService';
import { createLlmUsageTracker } from '../services/LlmUsageTracker';
import { createLlmGuard } from '../services/LlmGuard';
import { createSummarizationService } from '../services/SummarizationService';
import { createTranscriptEnricher } from '../services/TranscriptEnricher';
import { createLlmDeduplicationEnhancer } from '../services/LlmDeduplicationEnhancer';
import type { ILlmDeduplicationEnhancer } from '../services/LlmDeduplicationEnhancer';
import { createNlCurationService } from '../services/NlCurationService';
import { createTaskTypeDetector } from '../services/TaskTypeDetector';
import type { ICurationService } from '../../domain/interfaces/ICurationService';
import type { IConsolidationService } from '../../domain/interfaces/IConsolidationService';
import type { ISummarizationService } from '../../domain/interfaces/ISummarizationService';
import { createRepositoryRouter, closeConnections } from '../dal';
import { createLogger, createNullLogger } from '../logging';

/**
 * Result of bootstrapping the container.
 */
export interface IBootstrapResult {
  /** The configured container */
  container: IContainer;

  /** Cleanup function to dispose container and connections */
  dispose: () => Promise<void>;
}

/**
 * Default MCP endpoint from environment or fallback.
 */
function getDefaultEndpoint(): string {
  return process.env.MCP_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8000/mcp/';
}

/**
 * Default API key from environment.
 */
function getDefaultApiKey(): string | undefined {
  return process.env.ZEP_API_KEY;
}

/**
 * Bootstrap the DI container with all service registrations.
 *
 * @param config - Service configuration options
 * @returns Container and cleanup function
 */
export async function bootstrapContainer(config: IServiceConfig = {}): Promise<IBootstrapResult> {
  const container = createContainer();

  const projectRoot = config.projectRoot || process.cwd();
  const mcpEndpoint = config.mcpEndpoint || getDefaultEndpoint();
  const apiKey = config.apiKey || getDefaultApiKey();
  const enableRouter = config.enableRouter !== false;

  // Store config values as singletons
  container.registerInstance(TOKENS.ProjectRoot, projectRoot);
  container.registerInstance(TOKENS.McpEndpoint, mcpEndpoint);
  if (apiKey) {
    container.registerInstance(TOKENS.ApiKey, apiKey);
  }
  container.registerInstance(TOKENS.ServiceConfig, config);

  // ============================================================
  // Infrastructure Layer - Singletons
  // ============================================================

  // Logger (singleton - shared across app)
  const logger = config.logger ?? (config.disableLogging ? createNullLogger() : createLogger());
  container.registerInstance(TOKENS.Logger, logger);

  // Context (singleton - rarely changes)
  const context = ContextDetector.detect(projectRoot);
  container.registerInstance(TOKENS.Context, context);

  // MCP Client (singleton - connection reuse)
  const mcp = new McpClient(mcpEndpoint, apiKey);
  container.registerInstance(TOKENS.McpClient, mcp);

  // Event Emitter (singleton - pub/sub)
  const events = new EventEmitter();
  container.registerInstance(TOKENS.EventEmitter, events);

  // Repository Router (singleton - expensive DAL connections)
  let router: IRepositoryRouter | undefined;
  let connections: IConnectionManagers = {};

  if (enableRouter) {
    const log = logger.child({ component: 'Bootstrap' });
    try {
      const dalConfig = {
        mcpEndpoint,
        mcpApiKey: apiKey,
        logger: logger.child({ component: 'DAL' }),
        ...config.dalConfig,
      };

      const result = await createRepositoryRouter(dalConfig);
      router = result.router;
      connections = result.connections;

      const backends = result.availableBackends.join(', ');
      log.info('DAL router initialized', { backends });
    } catch (error) {
      log.warn('DAL router initialization failed, using MCP-only mode', {
        error: (error as Error).message,
      });
    }
  }

  if (router) {
    container.registerInstance(TOKENS.RepositoryRouter, router);
  }
  container.registerInstance(TOKENS.ConnectionManagers, connections);

  // ============================================================
  // Infrastructure Layer - Transient Services
  // ============================================================

  // Memory Service (transient - stateless)
  container.register(
    TOKENS.MemoryService,
    async () => {
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const mcpClient = await container.resolve<McpClient>(TOKENS.McpClient);
      const repoRouter = container.isRegistered(TOKENS.RepositoryRouter)
        ? await container.resolve<IRepositoryRouter>(TOKENS.RepositoryRouter)
        : undefined;
      return new MemoryService(mcpClient, repoRouter, log.child({ service: 'memory' }));
    },
    'transient'
  );

  // Task Service (transient - stateless)
  container.register(
    TOKENS.TaskService,
    async () => {
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const mcpClient = await container.resolve<McpClient>(TOKENS.McpClient);
      const repoRouter = container.isRegistered(TOKENS.RepositoryRouter)
        ? await container.resolve<IRepositoryRouter>(TOKENS.RepositoryRouter)
        : undefined;
      return new TaskService(mcpClient, repoRouter, log.child({ service: 'tasks' }));
    },
    'transient'
  );

  // Transcript Enricher (transient - stateless LLM-powered extraction)
  container.register(
    TOKENS.TranscriptEnricher,
    async () => {
      const guard = await container.resolve<ILlmGuard>(TOKENS.LlmGuard);
      const log = logger.child({ service: 'transcript-enricher' });
      return createTranscriptEnricher(guard, log);
    },
    'transient'
  );

  // Session Capture Service (transient - stateless, optional LLM enrichment)
  container.register(
    TOKENS.SessionCaptureService,
    async () => {
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const enricher = container.isRegistered(TOKENS.TranscriptEnricher)
        ? await container.resolve<ITranscriptEnricher>(TOKENS.TranscriptEnricher)
        : undefined;
      return new SessionCaptureService(log.child({ service: 'session-capture' }), enricher);
    },
    'transient'
  );

  // Recursion Service (transient - lightweight)
  container.register(
    TOKENS.RecursionService,
    async () => {
      const memory = await container.resolve<MemoryService>(TOKENS.MemoryService);
      const tasks = await container.resolve<TaskService>(TOKENS.TaskService);
      return new RecursionService(memory, tasks);
    },
    'transient'
  );

  // LLM Deduplication Enhancer (transient - stateless LLM-powered semantic dedup)
  container.register(
    TOKENS.LlmDeduplicationEnhancer,
    async () => {
      const guard = await container.resolve<ILlmGuard>(TOKENS.LlmGuard);
      const log = logger.child({ service: 'llm-dedup-enhancer' });
      return createLlmDeduplicationEnhancer(guard, log);
    },
    'transient'
  );

  // Deduplication Service (transient - stateless algorithm, optional LLM enhancement)
  container.register(
    TOKENS.DeduplicationService,
    async () => {
      const memory = await container.resolve<MemoryService>(TOKENS.MemoryService);
      const enhancer = container.isRegistered(TOKENS.LlmDeduplicationEnhancer)
        ? await container.resolve<ILlmDeduplicationEnhancer>(TOKENS.LlmDeduplicationEnhancer)
        : undefined;
      return createDeduplicationService(memory as unknown as IMemoryServiceWithQuality, enhancer);
    },
    'transient'
  );

  // Curation Service (transient - stateless)
  container.register(
    TOKENS.CurationService,
    async () => {
      const memory = await container.resolve<MemoryService>(TOKENS.MemoryService);
      return createCurationService(memory);
    },
    'transient'
  );

  // Consolidation Service (transient - stateless)
  container.register(
    TOKENS.ConsolidationService,
    async () => {
      const memory = await container.resolve<MemoryService>(TOKENS.MemoryService);
      return createConsolidationService(memory, memory);
    },
    'transient'
  );

  // Preference Store (singleton - file-based, no connection state)
  container.registerInstance(
    TOKENS.PreferenceStore,
    createPreferenceStore(projectRoot, logger.child({ service: 'preferences' }))
  );

  // LLM Config Service (singleton - reads from preferences + env)
  container.register(
    TOKENS.LlmConfigService,
    async () => {
      const prefs = await container.resolve<IPreferenceStore>(TOKENS.PreferenceStore);
      return createLlmConfigService(prefs);
    },
    'singleton'
  );

  // LLM Service (singleton - stateless HTTP client)
  container.register(
    TOKENS.LlmService,
    async () => {
      const configSvc = await container.resolve<ILlmConfigService>(TOKENS.LlmConfigService);
      const log = logger.child({ service: 'llm' });
      return createLlmService(configSvc, log);
    },
    'singleton'
  );

  // LLM Usage Tracker (singleton - append-only log file)
  container.register(
    TOKENS.LlmUsageTracker,
    async () => {
      const prefs = await container.resolve<IPreferenceStore>(TOKENS.PreferenceStore);
      const log = logger.child({ service: 'llm-usage' });
      return createLlmUsageTracker(projectRoot, prefs, log);
    },
    'singleton'
  );

  // LLM Guard (singleton - policy decorator over LlmService)
  container.register(
    TOKENS.LlmGuard,
    async () => {
      const llmSvc = await container.resolve<ILlmService>(TOKENS.LlmService);
      const tracker = await container.resolve<ILlmUsageTracker>(TOKENS.LlmUsageTracker);
      const configSvc = await container.resolve<ILlmConfigService>(TOKENS.LlmConfigService);
      const prefs = await container.resolve<IPreferenceStore>(TOKENS.PreferenceStore);
      const log = logger.child({ service: 'llm-guard' });
      return createLlmGuard(llmSvc, tracker, configSvc, prefs, log);
    },
    'singleton'
  );

  // Summarization Service (transient - stateless)
  container.register(
    TOKENS.SummarizationService,
    async () => {
      const memory = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const guard = await container.resolve<ILlmGuard>(TOKENS.LlmGuard);
      const log = logger.child({ service: 'summarization' });
      return createSummarizationService(memory, guard, log);
    },
    'transient'
  );

  // NL Curation Service (transient - stateless, depends on multiple services)
  container.register(
    TOKENS.NlCurationService,
    async () => {
      const guard = await container.resolve<ILlmGuard>(TOKENS.LlmGuard);
      const memory = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const curation = await container.resolve<ICurationService>(TOKENS.CurationService);
      const consolidation = await container.resolve<IConsolidationService>(TOKENS.ConsolidationService);
      const summarization = await container.resolve<ISummarizationService>(TOKENS.SummarizationService);
      const log = logger.child({ service: 'nl-curation' });
      return createNlCurationService(guard, memory, curation, consolidation, summarization, log);
    },
    'transient'
  );

  // Task Type Detector (singleton - stateless, deterministic)
  container.registerInstance(TOKENS.TaskTypeDetector, createTaskTypeDetector());

  // GitHub Sync Service (singleton - optional, may not be available)
  const enableGitHubSync = config.enableGitHubSync !== false;
  if (enableGitHubSync) {
    container.register(
      TOKENS.GitHubSyncService,
      async () => {
        const log = logger.child({ service: 'github-sync' });
        try {
          const {
            createGitHubClient,
            createGitHubSyncService,
            createTaskService: createSkillTaskService,
          } = await import('../../skills/shared/services');
          const {
            createGhCliClientFromEnv,
            createNeo4jClient,
            createNeo4jConfigFromEnv,
            createMcpClient: createSkillMcpClient,
            createMcpConfigFromEnv,
            createZepClient,
            createZepConfigFromEnv,
          } = await import('../../skills/shared/clients');

          const ghCli = createGhCliClientFromEnv();
          const githubClient = createGitHubClient(ghCli);

          const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv());
          const mcpSkillClient = createSkillMcpClient(createMcpConfigFromEnv());
          const zepConfig = createZepConfigFromEnv();
          const zepClient = zepConfig ? createZepClient(zepConfig) : null;

          const skillTaskService = createSkillTaskService({
            neo4jClient,
            mcpClient: mcpSkillClient,
            zepClient,
          });

          const service = createGitHubSyncService({
            github: githubClient,
            tasks: skillTaskService,
          });

          log.debug('GitHub sync service initialized');
          return service;
        } catch (error) {
          log.debug('GitHub sync service not available', {
            error: (error as Error).message,
          });
          return undefined;
        }
      },
      'singleton'
    );
  }

  // ============================================================
  // Application Layer - Handlers
  // ============================================================

  // Import handlers lazily to avoid circular dependencies
  container.register(
    TOKENS.SessionStartHandler,
    async () => {
      const { SessionStartHandler } = await import('../../application/handlers');
      const ctx = await container.resolve<ILisaContext>(TOKENS.Context);
      const mem = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const tsk = await container.resolve<ITaskService>(TOKENS.TaskService);
      const mcp = await container.resolve<IMcpClient>(TOKENS.McpClient);
      const rtr = container.isRegistered(TOKENS.RepositoryRouter)
        ? await container.resolve<IRepositoryRouter>(TOKENS.RepositoryRouter)
        : undefined;
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const ghSync = container.isRegistered(TOKENS.GitHubSyncService)
        ? await container.resolve<IGitHubSyncService | undefined>(TOKENS.GitHubSyncService)
        : undefined;
      return new SessionStartHandler(ctx, mem, tsk, mcp, rtr, log, ghSync);
    },
    'transient'
  );

  container.register(
    TOKENS.SessionStopHandler,
    async () => {
      const { SessionStopHandler } = await import('../../application/handlers');
      const ctx = await container.resolve<ILisaContext>(TOKENS.Context);
      const mem = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const cap = await container.resolve<ISessionCaptureService>(TOKENS.SessionCaptureService);
      const evt = await container.resolve<IEventEmitter>(TOKENS.EventEmitter);
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      return new SessionStopHandler(ctx, mem, cap, evt, log);
    },
    'transient'
  );

  container.register(
    TOKENS.PromptSubmitHandler,
    async () => {
      const { PromptSubmitHandler } = await import('../../application/handlers');
      const ctx = await container.resolve<ILisaContext>(TOKENS.Context);
      const mem = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const rec = await container.resolve<IRecursionService>(TOKENS.RecursionService);
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const detector = await container.resolve<ITaskTypeDetector>(TOKENS.TaskTypeDetector);
      return new PromptSubmitHandler(ctx, mem, rec, log, detector);
    },
    'transient'
  );

  // ============================================================
  // Application Layer - Mediator
  // ============================================================

  container.register(
    TOKENS.Mediator,
    async () => {
      const { createMediator } = await import('../../application/mediator');
      const { SessionStartRequest, SessionStopRequest, PromptSubmitRequest } = await import(
        '../../application/mediator/requests'
      );

      const mediator = createMediator();

      // Register handlers with proper types
      type SessionStartHandlerType = IRequestHandler<SessionStartRequest, ISessionStartResult>;
      type SessionStopHandlerType = IRequestHandler<SessionStopRequest, ISessionStopResult>;
      type PromptSubmitHandlerType = IRequestHandler<PromptSubmitRequest, IPromptSubmitResult>;

      const sessionStartHandler = await container.resolve<SessionStartHandlerType>(TOKENS.SessionStartHandler);
      const sessionStopHandler = await container.resolve<SessionStopHandlerType>(TOKENS.SessionStopHandler);
      const promptSubmitHandler = await container.resolve<PromptSubmitHandlerType>(TOKENS.PromptSubmitHandler);

      mediator.register(SessionStartRequest, sessionStartHandler);
      mediator.register(SessionStopRequest, sessionStopHandler);
      mediator.register(PromptSubmitRequest, promptSubmitHandler);

      return mediator;
    },
    'singleton'
  );

  // Cleanup function
  const dispose = async (): Promise<void> => {
    await container.dispose();
    await closeConnections(connections);
  };

  return { container, dispose };
}

