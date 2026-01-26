/**
 * Data Access Layer (DAL) Interfaces
 *
 * Provides abstractions for accessing memory and task data
 * across multiple backends (MCP, Neo4j, Zep Cloud).
 */

// Types
export type {
  SortField,
  SortOrder,
  ISortOption,
  IQueryOptions,
  BackendSource,
  IQueryResult,
  IMemoryQueryResult,
  ITaskQueryResult,
  OperationType,
} from './types';

export {
  DEFAULT_QUERY_OPTIONS,
  applyQueryDefaults,
} from './types';

// Connection Managers
export type {
  IConnectionConfig,
  IMcpConnectionConfig,
  INeo4jConnectionConfig,
  IZepConnectionConfig,
  IConnectionManager,
  IMcpConnectionManager,
  INeo4jConnectionManager,
  IZepConnectionManager,
} from './IConnectionManager';

// Memory Repository
export type {
  IMemorySaveOptions,
  IMemoryRepositoryReader,
  IMemoryRepositoryWriter,
  IMemoryRepositoryCapabilities,
  IMemoryRepository,
  IReadOnlyMemoryRepository,
} from './IMemoryRepository';

// Task Repository
export type {
  ITaskRepositoryReader,
  ITaskRepositoryWriter,
  ITaskRepositoryCapabilities,
  ITaskRepository,
  IReadOnlyTaskRepository,
} from './ITaskRepository';

// Pull Request Repository
export type {
  IPullRequestQueryOptions,
  IPullRequestQueryResult,
  IPullRequestRepositoryReader,
  IPullRequestRepositoryWriter,
  IPullRequestRepositoryCapabilities,
  IPullRequestRepository,
} from './IPullRequestRepository';

// Repository Router
export type {
  IRoutingRule,
  IRouterConfig,
  IRepositoryRouter,
  RepositoryRouterFactory,
} from './IRepositoryRouter';

export { DEFAULT_ROUTING_RULES } from './IRepositoryRouter';
