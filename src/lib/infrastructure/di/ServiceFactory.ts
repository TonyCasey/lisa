import type { ILisaServices, ILogger } from '../../domain/interfaces';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';
import { ContextDetector } from '../context';
import { McpClient } from '../mcp';
import { MemoryService, TaskService, EventEmitter, SessionCaptureService, RecursionService } from '../services';
import {
  createRepositoryRouter,
  closeConnections,
  type IConnectionManagers,
  type IRepositoryFactoryConfig,
} from '../dal';
import { createLogger, createNullLogger } from '../logging';
import {
  createGitHubClient,
  createGitHubSyncService,
  createTaskService as createSkillTaskService,
} from '../../skills/shared/services';
import {
  createGhCliClientFromEnv,
  createNeo4jClient,
  createNeo4jConfigFromEnv,
  createMcpClient as createSkillMcpClient,
  createMcpConfigFromEnv,
  createZepClient,
  createZepConfigFromEnv,
} from '../../skills/shared/clients';

/**
 * Configuration for creating Lisa services.
 */
export interface IServiceConfig {
  /** Project root directory (defaults to cwd) */
  projectRoot?: string;
  
  /** Git worktree path (for multi-worktree setups) */
  gitWorktree?: string;
  
  /** MCP endpoint URL */
  mcpEndpoint?: string;
  
  /** API key for Zep Cloud (if using) */
  apiKey?: string;
  
  /** Source CLI adapter ('claude-code' | 'opencode') */
  source?: 'claude-code' | 'opencode';
  
  /** Enable DAL router for multi-backend support (default: true) */
  enableRouter?: boolean;
  
  /** DAL router configuration overrides */
  dalConfig?: IRepositoryFactoryConfig;
  
  /** Custom logger instance (uses default if not provided) */
  logger?: ILogger;
  
  /** Disable logging entirely (for testing) */
  disableLogging?: boolean;
  
  /** Enable GitHub sync service for task synchronization (default: true if gh CLI available) */
  enableGitHubSync?: boolean;
}

/**
 * Extended services result including connection cleanup.
 */
export interface IServicesWithCleanup extends ILisaServices {
  /** Call to clean up connections when done */
  cleanup: () => Promise<void>;
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
 * Create Lisa services with dependency injection.
 *
 * @deprecated Use bootstrapContainer() instead for proper DI with lifetime management.
 */
export async function createServices(config: IServiceConfig = {}): Promise<ILisaServices> {
  const projectRoot = config.projectRoot || process.cwd();
  const mcpEndpoint = config.mcpEndpoint || getDefaultEndpoint();
  const apiKey = config.apiKey || getDefaultApiKey();
  const enableRouter = config.enableRouter !== false; // Default to true

  // Create logger (or use provided/null logger)
  const logger = config.logger ?? (config.disableLogging ? createNullLogger() : createLogger());
  const log = logger.child({ component: 'ServiceFactory' });

  // Detect context
  const context = ContextDetector.detect(projectRoot);

  // Create MCP client (always needed for fallback)
  const mcp = new McpClient(mcpEndpoint, apiKey);

  // Try to create DAL router for multi-backend support
  let router: IRepositoryRouter | undefined;
  
  if (enableRouter) {
    try {
      const dalConfig: IRepositoryFactoryConfig = {
        mcpEndpoint,
        mcpApiKey: apiKey,
        logger: logger.child({ component: 'DAL' }),
        ...config.dalConfig,
      };
      
      const result = await createRepositoryRouter(dalConfig);
      router = result.router;
      
      // Log available backends
      const backends = result.availableBackends.join(', ');
      log.info('DAL router initialized', { backends });
    } catch (error) {
      // DAL initialization failed - continue without router
      log.warn('DAL router initialization failed, using MCP-only mode', { 
        error: (error as Error).message 
      });
    }
  }

  // Create services (inject router if available)
  const memory = new MemoryService(mcp, router, logger.child({ service: 'memory' }));
  const tasks = new TaskService(mcp, router, logger.child({ service: 'tasks' }));
  const events = new EventEmitter();
  const sessionCapture = new SessionCaptureService();
  const recursion = new RecursionService(memory, tasks);

  // Try to create GitHub sync service (optional)
  let githubSync: IGitHubSyncService | undefined;
  const enableGitHubSync = config.enableGitHubSync !== false; // Default to true
  
  if (enableGitHubSync) {
    try {
      const ghCli = createGhCliClientFromEnv();
      const githubClient = createGitHubClient(ghCli);
      
      // Create skill-layer task service for sync operations
      const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv());
      const mcpSkillClient = createSkillMcpClient(createMcpConfigFromEnv());
      const zepConfig = createZepConfigFromEnv();
      const zepClient = zepConfig ? createZepClient(zepConfig) : null;
      
      const skillTaskService = createSkillTaskService({
        neo4jClient,
        mcpClient: mcpSkillClient,
        zepClient,
      });
      
      githubSync = createGitHubSyncService({
        github: githubClient,
        tasks: skillTaskService,
      });
      
      log.debug('GitHub sync service initialized');
    } catch (error) {
      // GitHub sync initialization failed - continue without it
      log.debug('GitHub sync service not available', { 
        error: (error as Error).message 
      });
    }
  }

  return {
    context,
    memory,
    tasks,
    mcp,
    events,
    sessionCapture,
    logger,
    router,
    recursion,
    githubSync,
  };
}

/**
 * Create Lisa services with cleanup function for connection management.
 * 
 * Use this when you need explicit control over connection lifecycle,
 * e.g., in scripts or CLI commands that should clean up on exit.
 *
 * @deprecated Use bootstrapContainer() instead for proper DI with lifetime management.
 */
export async function createServicesWithCleanup(config: IServiceConfig = {}): Promise<IServicesWithCleanup> {
  const projectRoot = config.projectRoot || process.cwd();
  const mcpEndpoint = config.mcpEndpoint || getDefaultEndpoint();
  const apiKey = config.apiKey || getDefaultApiKey();
  const enableRouter = config.enableRouter !== false;

  // Create logger (or use provided/null logger)
  const logger = config.logger ?? (config.disableLogging ? createNullLogger() : createLogger());
  const log = logger.child({ component: 'ServiceFactory' });

  // Detect context
  const context = ContextDetector.detect(projectRoot);

  // Create MCP client
  const mcp = new McpClient(mcpEndpoint, apiKey);

  // Try to create DAL router
  let router: IRepositoryRouter | undefined;
  let connections: IConnectionManagers = {};
  
  if (enableRouter) {
    try {
      const dalConfig: IRepositoryFactoryConfig = {
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
      log.warn('DAL router initialization failed', { error: (error as Error).message });
    }
  }

  // Create services
  const memory = new MemoryService(mcp, router, logger.child({ service: 'memory' }));
  const tasks = new TaskService(mcp, router, logger.child({ service: 'tasks' }));
  const events = new EventEmitter();
  const sessionCapture = new SessionCaptureService();
  const recursion = new RecursionService(memory, tasks);

  // Try to create GitHub sync service (optional)
  let githubSync: IGitHubSyncService | undefined;
  const enableGitHubSync = config.enableGitHubSync !== false;
  
  if (enableGitHubSync) {
    try {
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
      
      githubSync = createGitHubSyncService({
        github: githubClient,
        tasks: skillTaskService,
      });
      
      log.debug('GitHub sync service initialized');
    } catch (error) {
      log.debug('GitHub sync service not available', { 
        error: (error as Error).message 
      });
    }
  }

  // Cleanup function to close all connections
  const cleanup = async (): Promise<void> => {
    log.debug('Cleaning up connections');
    await closeConnections(connections);
  };

  return {
    context,
    memory,
    tasks,
    mcp,
    events,
    sessionCapture,
    logger,
    router,
    recursion,
    githubSync,
    cleanup,
  };
}
