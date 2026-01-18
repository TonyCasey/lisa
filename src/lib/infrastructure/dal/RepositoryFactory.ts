/**
 * Repository Factory
 *
 * Creates and configures the repository router with all available backends.
 * Reads configuration from environment variables.
 */

import type { IRepositoryRouter, BackendSource } from '../../domain/interfaces/dal';
import type { ILogger } from '../../domain/interfaces';
import { RepositoryRouter } from './routing';
import {
  McpConnectionManager,
  Neo4jConnectionManager,
  ZepConnectionManager,
  createMcpConnectionManager,
  createNeo4jConnectionManager,
  createZepConnectionManager,
} from './connections';
import {
  McpMemoryRepository,
  McpTaskRepository,
  Neo4jMemoryRepository,
  Neo4jTaskRepository,
  ZepMemoryRepository,
  ZepTaskRepository,
} from './repositories';
import { NullLogger } from '../logging';

/**
 * Factory configuration options.
 */
export interface IRepositoryFactoryConfig {
  /** Enable MCP backend (default: true if endpoint available) */
  mcp?: boolean;
  /** Enable Neo4j backend (default: true if URI available) */
  neo4j?: boolean;
  /** Enable Zep Cloud backend (default: true if API key available) */
  zep?: boolean;

  /** MCP endpoint override */
  mcpEndpoint?: string;
  /** MCP API key override */
  mcpApiKey?: string;

  /** Neo4j URI override */
  neo4jUri?: string;
  /** Neo4j username override */
  neo4jUsername?: string;
  /** Neo4j password override */
  neo4jPassword?: string;
  /** Neo4j database override */
  neo4jDatabase?: string;

  /** Zep API key override */
  zepApiKey?: string;
  /** Zep endpoint override */
  zepEndpoint?: string;
  
  /** Logger instance for diagnostic output */
  logger?: ILogger;
}

/**
 * Connection managers holder for lifecycle management.
 */
export interface IConnectionManagers {
  mcp?: McpConnectionManager;
  neo4j?: Neo4jConnectionManager;
  zep?: ZepConnectionManager;
}

/**
 * Factory result including router and connection managers.
 */
export interface IRepositoryFactoryResult {
  router: IRepositoryRouter;
  connections: IConnectionManagers;
  availableBackends: readonly BackendSource[];
}

/**
 * Create a fully configured repository router.
 *
 * This function:
 * 1. Detects available backends from environment
 * 2. Creates connection managers for each backend
 * 3. Creates repositories for each backend
 * 4. Registers everything with the router
 *
 * @param config Optional configuration overrides
 */
export async function createRepositoryRouter(
  config?: IRepositoryFactoryConfig
): Promise<IRepositoryFactoryResult> {
  const logger = config?.logger ?? new NullLogger();
  const log = logger.child({ component: 'RepositoryFactory' });
  
  log.debug('Creating repository router', {
    enableMcp: config?.mcp !== false,
    enableNeo4j: config?.neo4j !== false,
    enableZep: config?.zep !== false,
  });
  
  const router = new RepositoryRouter(undefined, logger.child({ component: 'RepositoryRouter' }));
  const connections: IConnectionManagers = {};
  const availableBackends: BackendSource[] = [];

  // Determine which backends to enable
  const enableMcp = config?.mcp !== false;
  const enableNeo4j = config?.neo4j !== false;
  const enableZep = config?.zep !== false;

  // Try to initialize MCP backend
  if (enableMcp) {
    try {
      log.debug('Initializing MCP backend');
      const mcpConnection = createMcpConnectionManager(
        config?.mcpEndpoint,
        config?.mcpApiKey
      );

      // Test connection
      await mcpConnection.connect();

      // Create repositories
      const mcpMemoryRepo = new McpMemoryRepository(mcpConnection);
      const mcpTaskRepo = new McpTaskRepository(mcpConnection);

      // Register with router
      router.registerMemoryRepository('mcp', mcpMemoryRepo);
      router.registerTaskRepository('mcp', mcpTaskRepo);

      connections.mcp = mcpConnection;
      availableBackends.push('mcp');
      log.info('MCP backend initialized');
    } catch (error) {
      log.warn('MCP backend not available', { error: (error as Error).message });
    }
  }

  // Try to initialize Neo4j backend
  if (enableNeo4j) {
    try {
      log.debug('Initializing Neo4j backend');
      const neo4jConnection = createNeo4jConnectionManager(
        config?.neo4jUri,
        config?.neo4jUsername,
        config?.neo4jPassword,
        config?.neo4jDatabase
      );

      // Test connection
      await neo4jConnection.connect();

      // Create repositories
      const neo4jMemoryRepo = new Neo4jMemoryRepository(neo4jConnection);
      const neo4jTaskRepo = new Neo4jTaskRepository(neo4jConnection);

      // Register with router
      router.registerMemoryRepository('neo4j', neo4jMemoryRepo);
      router.registerTaskRepository('neo4j', neo4jTaskRepo);

      connections.neo4j = neo4jConnection;
      availableBackends.push('neo4j');
      log.info('Neo4j backend initialized');
    } catch (error) {
      log.warn('Neo4j backend not available', { error: (error as Error).message });
    }
  }

  // Try to initialize Zep backend
  if (enableZep) {
    try {
      log.debug('Initializing Zep backend');
      const zepConnection = createZepConnectionManager(
        config?.zepApiKey,
        config?.zepEndpoint
      );

      if (zepConnection) {
        // Test connection
        await zepConnection.connect();

        // Create repositories
        const zepMemoryRepo = new ZepMemoryRepository(zepConnection);
        const zepTaskRepo = new ZepTaskRepository(zepConnection);

        // Register with router
        router.registerMemoryRepository('zep', zepMemoryRepo);
        router.registerTaskRepository('zep', zepTaskRepo);

        connections.zep = zepConnection;
        availableBackends.push('zep');
        log.info('Zep backend initialized');
      }
    } catch (error) {
      log.warn('Zep backend not available', { error: (error as Error).message });
    }
  }

  // Ensure at least one backend is available
  if (availableBackends.length === 0) {
    log.error('No DAL backends available');
    throw new Error(
      'No DAL backends available. Please configure at least one of: MCP (GRAPHITI_ENDPOINT), Neo4j (NEO4J_URI), or Zep (ZEP_API_KEY).'
    );
  }

  log.info('Repository router created', { backends: availableBackends });

  return {
    router,
    connections,
    availableBackends,
  };
}

/**
 * Close all connection managers.
 */
export async function closeConnections(connections: IConnectionManagers): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (connections.mcp) {
    closePromises.push(connections.mcp.disconnect());
  }
  if (connections.neo4j) {
    closePromises.push(connections.neo4j.disconnect());
  }
  if (connections.zep) {
    closePromises.push(connections.zep.disconnect());
  }

  await Promise.all(closePromises);
}
