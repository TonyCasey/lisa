/**
 * Container Bootstrap.
 *
 * Configures and initializes the DI container with all service registrations.
 * This is the composition root where all dependencies are wired together.
 *
 * Memory backend: git-mem (stores memories in git notes refs/notes/mem).
 */

import type { IContainer } from './IContainer';
import type { IServiceConfig } from './ServiceFactory';
import type {
  ILogger,
  ILisaContext,
  IMemoryService,
  ITaskService,
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
import {
  EventEmitter,
  SessionCaptureService,
  RecursionService,
} from '../services';
import { GitMemMemoryService } from '../services/GitMemMemoryService';
import { GitMemTaskService } from '../services/GitMemTaskService';
import { createPreferenceStore } from '../services/PreferenceStore';
import { createLlmConfigService } from '../services/LlmConfigService';
import { createLlmService } from '../services/LlmService';
import { createLlmUsageTracker } from '../services/LlmUsageTracker';
import { createLlmGuard } from '../services/LlmGuard';
import { createSummarizationService } from '../services/SummarizationService';
import { createTranscriptEnricher } from '../services/TranscriptEnricher';
import type { ISummarizationService } from '../../domain/interfaces/ISummarizationService';
import { createLogger, createNullLogger } from '../logging';

// git-mem imports
import { MemoryService as GitMemService, NotesService, MemoryRepository } from 'git-mem/dist/index';

/**
 * Result of bootstrapping the container.
 */
export interface IBootstrapResult {
  /** The configured container */
  container: IContainer;

  /** Cleanup function to dispose container */
  dispose: () => Promise<void>;
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

  // Store config values as singletons
  container.registerInstance(TOKENS.ProjectRoot, projectRoot);
  container.registerInstance(TOKENS.ServiceConfig, config);

  // ============================================================
  // Infrastructure Layer - Singletons
  // ============================================================

  // Logger (singleton - shared across app)
  const logger = config.logger ?? (
    config.disableLogging
      ? createNullLogger()
      : createLogger({ asyncWrites: config.asyncLogging })
  );
  container.registerInstance(TOKENS.Logger, logger);

  // Context (singleton - rarely changes)
  const context = ContextDetector.detect(projectRoot);
  container.registerInstance(TOKENS.Context, context);

  // Event Emitter (singleton - pub/sub)
  const events = new EventEmitter();
  container.registerInstance(TOKENS.EventEmitter, events);

  // ============================================================
  // git-mem Memory Backend
  // ============================================================

  // Wire git-mem: NotesService → MemoryRepository → MemoryService
  const notesService = new NotesService();
  const memoryRepo = new MemoryRepository(notesService);
  const gitMemService = new GitMemService(memoryRepo);

  // Memory Service (singleton - wraps git-mem)
  const memoryService = new GitMemMemoryService(gitMemService);
  container.registerInstance(TOKENS.MemoryService, memoryService);

  // Task Service (singleton - wraps git-mem)
  const taskService = new GitMemTaskService(gitMemService);
  container.registerInstance(TOKENS.TaskService, taskService);

  // ============================================================
  // Infrastructure Layer - Transient Services
  // ============================================================

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
      const mem = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const tsk = await container.resolve<ITaskService>(TOKENS.TaskService);
      return new RecursionService(mem, tsk);
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
      const mem = await container.resolve<IMemoryService>(TOKENS.MemoryService);
      const guard = await container.resolve<ILlmGuard>(TOKENS.LlmGuard);
      const log = logger.child({ service: 'summarization' });
      return createSummarizationService(mem, guard, log);
    },
    'transient'
  );

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
            createGitMem,
          } = await import('../../skills/shared/clients');

          const ghCli = createGhCliClientFromEnv();
          const githubClient = createGitHubClient(ghCli);

          const skillGitMem = createGitMem();
          const skillTaskService = createSkillTaskService({ gitMem: skillGitMem });

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
      const log = await container.resolve<ILogger>(TOKENS.Logger);
      const ghSync = container.isRegistered(TOKENS.GitHubSyncService)
        ? await container.resolve<IGitHubSyncService | undefined>(TOKENS.GitHubSyncService)
        : undefined;
      return new SessionStartHandler(ctx, mem, tsk, log, ghSync);
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
      return new PromptSubmitHandler(ctx, mem, rec, log);
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
  };

  return { container, dispose };
}
