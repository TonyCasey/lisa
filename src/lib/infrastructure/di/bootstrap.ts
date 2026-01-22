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
} from '../../domain/interfaces';
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

  // Session Capture Service (transient - stateless)
  container.registerSync(TOKENS.SessionCaptureService, () => new SessionCaptureService(), 'transient');

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
      return new SessionStartHandler(ctx, mem, tsk, mcp, rtr, log);
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
    await closeConnections(connections);
  };

  return { container, dispose };
}

/**
 * Convenience function to bootstrap and get ILisaServices-compatible object.
 * This provides backward compatibility during migration.
 *
 * @deprecated Use bootstrapContainer() and resolve individual services instead
 */
export async function bootstrapServices(config: IServiceConfig = {}) {
  const { container, dispose } = await bootstrapContainer(config);

  return {
    context: await container.resolve(TOKENS.Context),
    memory: await container.resolve(TOKENS.MemoryService),
    tasks: await container.resolve(TOKENS.TaskService),
    mcp: await container.resolve(TOKENS.McpClient),
    events: await container.resolve(TOKENS.EventEmitter),
    sessionCapture: await container.resolve(TOKENS.SessionCaptureService),
    logger: await container.resolve(TOKENS.Logger),
    router: container.isRegistered(TOKENS.RepositoryRouter)
      ? await container.resolve(TOKENS.RepositoryRouter)
      : undefined,
    recursion: await container.resolve(TOKENS.RecursionService),
    cleanup: dispose,
  };
}
