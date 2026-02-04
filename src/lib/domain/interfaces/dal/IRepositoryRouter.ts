/**
 * Repository Router Interface
 *
 * Routes queries to the optimal backend based on operation type.
 * Enables using Neo4j for date-ordered queries while using MCP for semantic search.
 */

import { IMemoryRepository, IReadOnlyMemoryRepository } from './IMemoryRepository';
import { ITaskRepository, IReadOnlyTaskRepository } from './ITaskRepository';
import { OperationType, BackendSource } from './types';

/**
 * Routing rule configuration.
 */
export interface IRoutingRule {
  /** Operation type this rule applies to */
  readonly operation: OperationType;
  /** Preferred backend for this operation */
  readonly preferred: BackendSource;
  /** Fallback backend if preferred is unavailable */
  readonly fallback?: BackendSource;
}

/**
 * Router configuration.
 */
export interface IRouterConfig {
  /** Available backends */
  readonly backends: readonly BackendSource[];
  /** Custom routing rules (overrides defaults) */
  readonly rules?: readonly IRoutingRule[];
}

/**
 * Default routing rules.
 * - list: Neo4j (date ordering) -> MCP
 * - search: MCP (semantic search) -> Zep
 * - write: MCP (ingestion pipeline) -> Neo4j
 * - aggregate: Neo4j (Cypher aggregation) -> MCP
 */
export const DEFAULT_ROUTING_RULES: readonly IRoutingRule[] = [
  { operation: 'list', preferred: 'neo4j', fallback: 'mcp' },
  { operation: 'search', preferred: 'mcp', fallback: 'zep' },
  { operation: 'write', preferred: 'mcp', fallback: 'neo4j' },
  { operation: 'aggregate', preferred: 'neo4j', fallback: 'mcp' },
];

/**
 * Repository router interface.
 * Routes to the optimal backend based on operation type.
 */
export interface IRepositoryRouter {
  /**
   * Get the optimal memory repository for the given operation.
   * @param operation - Type of operation to perform
   */
  getMemoryRepository(operation: OperationType): IMemoryRepository | IReadOnlyMemoryRepository;

  /**
   * Get the optimal task repository for the given operation.
   * @param operation - Type of operation to perform
   */
  getTaskRepository(operation: OperationType): ITaskRepository | IReadOnlyTaskRepository;

  /**
   * Get a specific memory repository by backend.
   * @param backend - Backend to use
   */
  getMemoryRepositoryByBackend(backend: BackendSource): IMemoryRepository | IReadOnlyMemoryRepository | null;

  /**
   * Get a specific task repository by backend.
   * @param backend - Backend to use
   */
  getTaskRepositoryByBackend(backend: BackendSource): ITaskRepository | IReadOnlyTaskRepository | null;

  /**
   * Check if a backend is available.
   * @param backend - Backend to check
   */
  isBackendAvailable(backend: BackendSource): boolean;

  /**
   * Get the list of available backends.
   */
  getAvailableBackends(): readonly BackendSource[];

  /**
   * Get the current routing rules.
   */
  getRoutingRules(): readonly IRoutingRule[];

  /**
   * Update a routing rule at runtime.
   * @param operation - Operation to update rule for
   * @param preferred - New preferred backend
   * @param fallback - New fallback backend
   */
  setRoutingRule(
    operation: OperationType,
    preferred: BackendSource,
    fallback?: BackendSource
  ): void;
}

/**
 * Factory function type for creating a repository router.
 */
export type RepositoryRouterFactory = (config?: Partial<IRouterConfig>) => Promise<IRepositoryRouter>;
