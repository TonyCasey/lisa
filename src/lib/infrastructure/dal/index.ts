/**
 * Data Access Layer (DAL) Infrastructure
 *
 * Provides multi-backend support for memory and task operations.
 *
 * Usage:
 * ```typescript
 * import { createRepositoryRouter } from './dal';
 *
 * const { router, connections } = await createRepositoryRouter();
 *
 * // Get optimal repository for operation
 * const memoryRepo = router.getMemoryRepository('list');
 * const facts = await memoryRepo.findByGroupIds(['my-group'], {
 *   sort: { field: 'created_at', order: 'desc' },
 *   limit: 10,
 * });
 *
 * // Clean up
 * await closeConnections(connections);
 * ```
 */

// Factory
export {
  createRepositoryRouter,
  closeConnections,
  type IRepositoryFactoryConfig,
  type IConnectionManagers,
  type IRepositoryFactoryResult,
} from './RepositoryFactory';

// Routing
export { RepositoryRouter, createRouter } from './routing';

// Connection Managers
export {
  McpConnectionManager,
  Neo4jConnectionManager,
  ZepConnectionManager,
  createMcpConnectionManager,
  createNeo4jConnectionManager,
  createZepConnectionManager,
} from './connections';

// Repositories
export {
  McpMemoryRepository,
  McpTaskRepository,
  Neo4jMemoryRepository,
  Neo4jTaskRepository,
  Neo4jPullRequestRepository,
  Neo4jMemoryRelationshipRepository,
  ZepMemoryRepository,
  ZepTaskRepository,
} from './repositories';
