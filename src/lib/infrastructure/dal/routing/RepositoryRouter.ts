/**
 * Repository Router
 *
 * Routes queries to the optimal backend based on operation type.
 * Enables using Neo4j for date-ordered queries while using MCP for semantic search.
 */

import type {
  IRepositoryRouter,
  IRoutingRule,
  IRouterConfig,
  IMemoryRepository,
  IReadOnlyMemoryRepository,
  ITaskRepository,
  IReadOnlyTaskRepository,
  OperationType,
  BackendSource,
} from '../../../domain/interfaces/dal';
import type { ILogger } from '../../../domain/interfaces';
import { DEFAULT_ROUTING_RULES } from '../../../domain/interfaces/dal';
import { NullLogger } from '../../logging';

/**
 * Repository Router implementation.
 * Routes to the optimal backend based on operation type.
 */
export class RepositoryRouter implements IRepositoryRouter {
  private readonly memoryRepositories: Map<BackendSource, IMemoryRepository | IReadOnlyMemoryRepository>;
  private readonly taskRepositories: Map<BackendSource, ITaskRepository | IReadOnlyTaskRepository>;
  private routingRules: Map<OperationType, IRoutingRule>;
  private readonly availableBackends: Set<BackendSource>;
  private readonly logger: ILogger;

  constructor(config?: IRouterConfig, logger?: ILogger) {
    this.logger = logger ?? new NullLogger();
    this.memoryRepositories = new Map();
    this.taskRepositories = new Map();
    this.availableBackends = new Set(config?.backends || []);

    // Initialize routing rules from config or defaults
    this.routingRules = new Map();
    const rules = config?.rules || DEFAULT_ROUTING_RULES;
    for (const rule of rules) {
      this.routingRules.set(rule.operation, rule);
    }
    
    this.logger.debug('Router initialized', { 
      backends: [...this.availableBackends],
      rulesCount: this.routingRules.size,
    });
  }

  /**
   * Register a memory repository for a backend.
   */
  registerMemoryRepository(
    backend: BackendSource,
    repository: IMemoryRepository | IReadOnlyMemoryRepository
  ): void {
    this.memoryRepositories.set(backend, repository);
    this.availableBackends.add(backend);
    this.logger.debug('Registered memory repository', { backend });
  }

  /**
   * Register a task repository for a backend.
   */
  registerTaskRepository(
    backend: BackendSource,
    repository: ITaskRepository | IReadOnlyTaskRepository
  ): void {
    this.taskRepositories.set(backend, repository);
    this.availableBackends.add(backend);
    this.logger.debug('Registered task repository', { backend });
  }

  /**
   * Get the optimal memory repository for the given operation.
   */
  getMemoryRepository(operation: OperationType): IMemoryRepository | IReadOnlyMemoryRepository {
    const backend = this.resolveBackend(operation, this.memoryRepositories);
    const repo = this.memoryRepositories.get(backend);

    if (!repo) {
      throw new Error(
        `No memory repository available for operation '${operation}'. ` +
          `Tried: ${this.getTriedBackends(operation).join(', ')}`
      );
    }

    return repo;
  }

  /**
   * Get the optimal task repository for the given operation.
   */
  getTaskRepository(operation: OperationType): ITaskRepository | IReadOnlyTaskRepository {
    const backend = this.resolveBackend(operation, this.taskRepositories);
    const repo = this.taskRepositories.get(backend);

    if (!repo) {
      throw new Error(
        `No task repository available for operation '${operation}'. ` +
          `Tried: ${this.getTriedBackends(operation).join(', ')}`
      );
    }

    return repo;
  }

  /**
   * Get a specific memory repository by backend.
   */
  getMemoryRepositoryByBackend(
    backend: BackendSource
  ): IMemoryRepository | IReadOnlyMemoryRepository | null {
    return this.memoryRepositories.get(backend) || null;
  }

  /**
   * Get a specific task repository by backend.
   */
  getTaskRepositoryByBackend(
    backend: BackendSource
  ): ITaskRepository | IReadOnlyTaskRepository | null {
    return this.taskRepositories.get(backend) || null;
  }

  /**
   * Check if a backend is available.
   */
  isBackendAvailable(backend: BackendSource): boolean {
    return (
      this.memoryRepositories.has(backend) || this.taskRepositories.has(backend)
    );
  }

  /**
   * Get the list of available backends.
   */
  getAvailableBackends(): readonly BackendSource[] {
    return [...this.availableBackends];
  }

  /**
   * Get the current routing rules.
   */
  getRoutingRules(): readonly IRoutingRule[] {
    return [...this.routingRules.values()];
  }

  /**
   * Update a routing rule at runtime.
   */
  setRoutingRule(
    operation: OperationType,
    preferred: BackendSource,
    fallback?: BackendSource
  ): void {
    this.routingRules.set(operation, {
      operation,
      preferred,
      fallback,
    });
  }

  /**
   * Resolve the best available backend for an operation.
   */
  private resolveBackend<T>(
    operation: OperationType,
    repositories: Map<BackendSource, T>
  ): BackendSource {
    const rule = this.routingRules.get(operation);

    if (!rule) {
      // No rule - try any available backend
      for (const backend of repositories.keys()) {
        this.logger.debug('Resolved backend (no rule)', { operation, backend });
        return backend;
      }
      throw new Error(`No repositories available`);
    }

    // Try preferred backend
    if (repositories.has(rule.preferred)) {
      this.logger.debug('Resolved backend (preferred)', { operation, backend: rule.preferred });
      return rule.preferred;
    }

    // Try fallback
    if (rule.fallback && repositories.has(rule.fallback)) {
      this.logger.debug('Resolved backend (fallback)', { 
        operation, 
        preferred: rule.preferred, 
        backend: rule.fallback 
      });
      return rule.fallback;
    }

    // Try any available backend
    for (const backend of repositories.keys()) {
      this.logger.debug('Resolved backend (any available)', { operation, backend });
      return backend;
    }

    throw new Error(`No backend available for operation '${operation}'`);
  }

  /**
   * Get the backends that were tried for an operation (for error messages).
   */
  private getTriedBackends(operation: OperationType): BackendSource[] {
    const rule = this.routingRules.get(operation);
    if (!rule) {
      return [];
    }

    const tried: BackendSource[] = [rule.preferred];
    if (rule.fallback) {
      tried.push(rule.fallback);
    }
    return tried;
  }
}

/**
 * Create a repository router with the specified backends registered.
 */
export function createRouter(config?: IRouterConfig): RepositoryRouter {
  return new RepositoryRouter(config);
}
