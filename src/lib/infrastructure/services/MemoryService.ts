import type {
  IMemoryService,
  IMcpClient,
  IMemoryResult,
  IMemoryItem,
  ILogger,
  IMemoryResultBuilder,
  IStructuredLogger,
  ILogContext,
  IMemorySaveOptions,
  IMemoryQualityReader,
} from '../../domain';
import type { ConfidenceLevel } from '../../domain/interfaces/types/IMemoryQuality';
import type { IConflictGroup, IQueryOptions } from '../../domain/interfaces/dal/types';
import type { IMemoryRepositoryQuality } from '../../domain/interfaces/dal';
import {
  createMemoryResultBuilder,
  withCancellation,
  checkCancellation,
  isCancellationError,
  LogEvents,
} from '../../domain';
import { resolveLifecycleTag, LIFECYCLE_DEFAULTS } from '../../domain/interfaces/types/IMemoryLifecycle';
import { ContextDetector } from '../context';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import type { IMemoryRepositoryExpiration } from '../../domain/interfaces/dal';
import { NullLogger } from '../logging';

const MEMORY_LOAD_TIMEOUT_MS = 5000;

interface McpMemoryResponse {
  result?: {
    facts?: IMemoryItem[];
    nodes?: IMemoryItem[];
  };
  facts?: IMemoryItem[];
  nodes?: IMemoryItem[];
}

/**
 * Memory service implementation.
 * Supports both direct MCP and DAL router backends.
 *
 * When a router is provided, it will:
 * - Use Neo4j for date-ordered listing (if available)
 * - Use MCP for semantic search
 * - Use MCP for writes
 *
 * When only MCP is provided, falls back to MCP for all operations.
 */
export class MemoryService implements IMemoryService, IMemoryQualityReader {
  private readonly logger: ILogger;
  private readonly structuredLogger: IStructuredLogger;

  constructor(
    private readonly mcp: IMcpClient,
    private readonly router?: IRepositoryRouter,
    logger?: ILogger
  ) {
    const nullLogger = new NullLogger();
    this.logger = logger ?? nullLogger;
    // Use the logger as structured logger if it implements IStructuredLogger
    this.structuredLogger = (logger && 'logEvent' in logger)
      ? (logger as unknown as IStructuredLogger)
      : nullLogger;
  }

  /**
   * Create log context for memory operations.
   */
  private createLogContext(groupIds: readonly string[], operation?: string): ILogContext {
    return {
      groupId: groupIds[0],
      operation,
      sessionId: this.mcp.getSessionId() ?? undefined,
    };
  }

  /**
   * Load memory for a group, querying hierarchically.
   *
   * Uses AbortController-based cancellation to ensure no mutations
   * occur after timeout and resources are properly cleaned up.
   *
   * Note: Session ID management is handled internally by McpClient.
   * Callers do not need to track session IDs.
   *
   * @param groupIds - Hierarchical group IDs to query
   * @param aliases - Project aliases for additional queries
   * @param branch - Current git branch (optional)
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @param signal - External abort signal for cancellation (optional)
   */
  async loadMemory(
    groupIds: readonly string[],
    aliases: readonly string[],
    branch: string | null,
    timeoutMs: number = MEMORY_LOAD_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<IMemoryResult> {
    const logContext = this.createLogContext(groupIds, 'loadMemory');
    const completeOperation = this.structuredLogger.startOperation(
      LogEvents.MEMORY_LOAD_START,
      { ...logContext, branch: branch ?? undefined }
    );

    const result: IMemoryResultBuilder = createMemoryResultBuilder();

    const cancellableResult = await withCancellation(
      async (abortSignal) => {
        // Load init-review memory first (codebase summary)
        // Session managed internally by McpClient - no need to track session ID
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before init-review');

          const initParams = {
            query: 'init-review',
            max_facts: 1,
            order: 'desc',
            group_ids: [...groupIds],
            tags: ['type:init-review'],
          };
          const [initResp] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', initParams);

          // Check cancellation before mutating result
          checkCancellation(abortSignal, 'Memory load cancelled after init-review fetch');

          const initFacts = initResp?.result?.facts || initResp?.facts || [];
          if (initFacts.length > 0) {
            const fact = initFacts[0];
            result.initReview = fact?.fact || fact?.name || null;
            this.logger.debug('Loaded init-review');
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          this.logger.debug('Failed to load init-review', { error: (error as Error).message });
        }

        // Load recent facts/nodes from memory using hierarchical groups
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before facts');

          const seenUuids = new Set<string>();

          // Query with hierarchical groups
          const recentParams = {
            query: '*',
            max_facts: 100,
            order: 'desc',
            group_ids: [...groupIds],
          };
          const [recentResp] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', recentParams);

          // Check cancellation before mutating result
          checkCancellation(abortSignal, 'Memory load cancelled after facts fetch');

          const recentFacts = recentResp?.result?.facts || recentResp?.facts || [];
          for (const fact of recentFacts) {
            const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
            if (!seenUuids.has(uuid)) {
              seenUuids.add(uuid);
              result.facts.push(fact);
            }
          }

          // Also query by repo aliases
          for (const alias of aliases) {
            checkCancellation(abortSignal, 'Memory load cancelled during alias iteration');

            const baseParams = {
              query: alias,
              tags: ContextDetector.repoTags({ repo: alias, branch }),
            };
            const factParams = {
              ...baseParams,
              max_facts: 50,
              order: 'desc',
              group_ids: [...groupIds],
            };
            const [factResp] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', factParams);

            checkCancellation(abortSignal, 'Memory load cancelled after alias facts fetch');

            const aliasedFacts = factResp?.result?.facts || factResp?.facts || [];
            for (const fact of aliasedFacts) {
              const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
              if (!seenUuids.has(uuid)) {
                seenUuids.add(uuid);
                result.facts.push(fact);
              }
            }
          }

          // Fall back to nodes if no facts found
          if (!result.facts.length) {
            for (const alias of aliases) {
              checkCancellation(abortSignal, 'Memory load cancelled during node iteration');

              const baseParams = {
                query: alias,
                tags: ContextDetector.repoTags({ repo: alias, branch }),
              };
              const nodeParams = {
                ...baseParams,
                max_nodes: 20,
                group_ids: [...groupIds],
              };
              const [nodeResp] = await this.mcp.call<McpMemoryResponse>('search_nodes', nodeParams);

              checkCancellation(abortSignal, 'Memory load cancelled after nodes fetch');

              const aliasedNodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
              for (const node of aliasedNodes) {
                const uuid = node.uuid || `${node.name}-${node.fact}`;
                if (!seenUuids.has(uuid)) {
                  seenUuids.add(uuid);
                  result.nodes.push(node);
                }
              }
            }
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          this.logger.warn('Failed to load memory facts', { error: (error as Error).message });
        }

        // Load tasks for this repo
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before tasks');

          const seenTaskUuids = new Set<string>();

          for (const alias of aliases) {
            checkCancellation(abortSignal, 'Memory load cancelled during task iteration');

            const taskParams = {
              query: 'task',
              tags: ['type:task', ...ContextDetector.repoTags({ repo: alias, branch })],
              max_nodes: 200,
              group_ids: [...groupIds],
            };
            const [taskResp] = await this.mcp.call<McpMemoryResponse>('search_nodes', taskParams);

            checkCancellation(abortSignal, 'Memory load cancelled after tasks fetch');

            const aliasedTasks = taskResp?.result?.nodes || taskResp?.nodes || [];
            for (const task of aliasedTasks) {
              const uuid = task.uuid || `${task.name}-${task.fact}`;
              if (!seenTaskUuids.has(uuid)) {
                seenTaskUuids.add(uuid);
                result.tasks.push(task);
              }
            }
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          this.logger.warn('Failed to load tasks', { error: (error as Error).message });
        }

        return result;
      },
      {
        timeoutMs,
        signal,
        onCancel: () => {
          this.logger.debug('Memory load cancelled');
        },
      }
    );

    // Set timedOut flag based on cancellation result
    result.timedOut = cancellableResult.timedOut;

    // Log completion with structured event
    if (result.timedOut) {
      this.structuredLogger.logEventWarn({
        event: LogEvents.MEMORY_LOAD_TIMEOUT,
        context: logContext,
        data: {
          factsCount: result.facts.length,
          nodesCount: result.nodes.length,
          tasksCount: result.tasks.length,
          hasInitReview: !!result.initReview,
        },
      });
    }

    completeOperation({
      data: {
        factsCount: result.facts.length,
        nodesCount: result.nodes.length,
        tasksCount: result.tasks.length,
        hasInitReview: !!result.initReview,
        timedOut: result.timedOut,
        cancelled: cancellableResult.cancelled,
      },
    });

    return result;
  }

  /**
   * Save facts to memory.
   */
  async saveMemory(groupId: string, facts: readonly string[]): Promise<void> {
    for (const fact of facts) {
      await this.addFact(groupId, fact);
    }
  }

  /**
   * Add a single fact to memory.
   */
  async addFact(groupId: string, fact: string, tags: readonly string[] = []): Promise<void> {
    const logContext = this.createLogContext([groupId], 'addFact');
    const completeOperation = this.structuredLogger.startOperation(
      LogEvents.MEMORY_SAVE_START,
      logContext
    );
    
    // Use DAL router if available for writes
    if (this.router) {
      try {
        const repo = this.router.getMemoryRepository('write');
        if ('save' in repo) {
          await repo.save(groupId, fact, { tags });
          completeOperation({ data: { backend: 'dal', factLength: fact.length } });
          return;
        }
      } catch (error) {
        // Log fallback event
        this.structuredLogger.logEvent({
          event: LogEvents.DAL_FALLBACK,
          context: logContext,
          data: { from: 'dal', to: 'mcp' },
          error: (error as Error).message,
        });
      }
    }

    await this.mcp.call('add_memory', {
      content: fact,
      group_ids: [groupId],
      tags: [...tags],
    });
    completeOperation({ data: { backend: 'mcp', factLength: fact.length } });
  }

  /**
   * Add a fact with lifecycle metadata.
   * Enriches tags with lifecycle:<tier> tag and delegates to addFact.
   */
  async addFactWithLifecycle(
    groupId: string,
    fact: string,
    options: IMemorySaveOptions
  ): Promise<void> {
    const lifecycle = options.lifecycle ?? 'project';
    const lifecycleTag = resolveLifecycleTag(lifecycle);

    // Merge lifecycle tag with existing tags
    const existingTags = options.tags ? [...options.tags] : [];
    if (!existingTags.includes(lifecycleTag)) {
      existingTags.push(lifecycleTag);
    }

    await this.addFact(groupId, fact, existingTags);
  }

  /**
   * Expire a single fact by UUID.
   * Routes to a repository that supports expiration.
   */
  async expireFact(groupId: string, uuid: string): Promise<void> {
    if (!this.router) {
      throw new Error('Expiration requires a DAL router with Neo4j support');
    }

    const repo = this.router.getMemoryRepository('list');
    if (!('expire' in repo)) {
      throw new Error('Memory repository does not support expiration');
    }
    await (repo as unknown as IMemoryRepositoryExpiration).expire(groupId, uuid);
  }

  /**
   * Clean up expired facts based on lifecycle TTL defaults.
   * Expires session facts older than 24h and ephemeral facts older than 1h.
   */
  async cleanupExpired(groupId: string): Promise<number> {
    if (!this.router) {
      throw new Error('Cleanup requires a DAL router with Neo4j support');
    }

    const repo = this.router.getMemoryRepository('list');
    if (!('expireByFilter' in repo)) {
      throw new Error('Memory repository does not support expiration');
    }
    const expirationRepo = repo as unknown as IMemoryRepositoryExpiration;

    const now = new Date();
    let totalExpired = 0;

    // Expire session facts older than their TTL (24h)
    const sessionTtl = LIFECYCLE_DEFAULTS.session;
    if (sessionTtl !== null) {
      const sessionCutoff = new Date(now.getTime() - sessionTtl);
      totalExpired += await expirationRepo.expireByFilter(groupId, {
        lifecycle: 'session',
        olderThan: sessionCutoff,
      });
    }

    // Expire ephemeral facts older than their TTL (1h)
    const ephemeralTtl = LIFECYCLE_DEFAULTS.ephemeral;
    if (ephemeralTtl !== null) {
      const ephemeralCutoff = new Date(now.getTime() - ephemeralTtl);
      totalExpired += await expirationRepo.expireByFilter(groupId, {
        lifecycle: 'ephemeral',
        olderThan: ephemeralCutoff,
      });
    }

    return totalExpired;
  }

  /**
   * Load facts using DAL router with date ordering.
   * This is an optimized path for simple listing without aliases.
   *
   * @param groupIds - Group IDs to query
   * @param limit - Maximum number of facts to return
   * @param options - Optional date filtering options
   */
  async loadFactsDateOrdered(
    groupIds: readonly string[],
    limit: number = 50,
    options?: { since?: Date; until?: Date }
  ): Promise<IMemoryItem[]> {
    const logContext = this.createLogContext(groupIds, 'loadFactsDateOrdered');
    const completeOperation = this.structuredLogger.startOperation(
      LogEvents.MEMORY_LOAD_START,
      logContext
    );
    
    if (!this.router) {
      // Fall back to MCP-only path
      const [response] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', {
        query: '*',
        max_facts: limit,
        order: 'desc',
        group_ids: [...groupIds],
      });
      let facts = response?.result?.facts || response?.facts || [];
      
      // Client-side date filtering for MCP fallback
      if (options?.since || options?.until) {
        facts = facts.filter(f => {
          if (!f.created_at) return true;
          const created = new Date(f.created_at).getTime();
          if (options.since && created < options.since.getTime()) return false;
          if (options.until && created > options.until.getTime()) return false;
          return true;
        });
      }
      
      // Client-side sort since MCP may not honor order
      const sorted = [...facts].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      completeOperation({ data: { backend: 'mcp', count: sorted.length } });
      return sorted;
    }

    // Use DAL router - prefer Neo4j for date-ordered listing
    try {
      const repo = this.router.getMemoryRepository('list');
      const result = await repo.findByGroupIds(groupIds, {
        sort: { field: 'created_at', order: 'desc' },
        limit,
        since: options?.since,
        until: options?.until,
      });
      completeOperation({ data: { backend: 'neo4j', count: result.items.length } });
      return [...result.items];
    } catch (error) {
      // Log fallback
      this.structuredLogger.logEvent({
        event: LogEvents.DAL_FALLBACK,
        context: logContext,
        data: { from: 'neo4j', to: 'mcp' },
        error: (error as Error).message,
      });
      
      const repo = this.router.getMemoryRepository('search');
      const result = await repo.findByGroupIds(groupIds, { limit });
      
      // Client-side date filtering for MCP fallback (MCP may not support date params)
      let items = [...result.items];
      if (options?.since || options?.until) {
        items = items.filter(item => {
          if (!item.created_at) return true;
          const created = new Date(item.created_at).getTime();
          if (options.since && created < options.since.getTime()) return false;
          if (options.until && created > options.until.getTime()) return false;
          return true;
        });
      }
      
      const sorted = items.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      completeOperation({ data: { backend: 'mcp-fallback', count: sorted.length } });
      return sorted;
    }
  }

  /**
   * Semantic search using DAL router.
   *
   * @param groupIds - Group IDs to search
   * @param query - Search query
   * @param limit - Maximum number of results
   */
  async searchFacts(
    groupIds: readonly string[],
    query: string,
    limit: number = 20
  ): Promise<IMemoryItem[]> {
    const logContext = this.createLogContext(groupIds, 'searchFacts');
    const completeOperation = this.structuredLogger.startOperation(
      LogEvents.MEMORY_SEARCH_START,
      logContext
    );
    
    if (!this.router) {
      // Fall back to MCP-only path
      const [response] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', {
        query,
        max_facts: limit,
        group_ids: [...groupIds],
      });
      const facts = response?.result?.facts || response?.facts || [];
      completeOperation({ data: { backend: 'mcp', resultsCount: facts.length, query } });
      return facts;
    }

    // Use DAL router - prefer MCP for semantic search
    try {
      const repo = this.router.getMemoryRepository('search');
      const result = await repo.findByGroupIds(groupIds, { query, limit });
      completeOperation({ data: { backend: 'dal', resultsCount: result.items.length, query } });
      return [...result.items];
    } catch (error) {
      completeOperation({
        data: { backend: 'dal', query },
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Find facts at or above a minimum confidence level.
   * Routes to Neo4j repository for tag-based confidence filtering.
   */
  async findByMinConfidence(
    groupIds: readonly string[],
    minLevel: ConfidenceLevel,
    options?: IQueryOptions
  ): Promise<IMemoryItem[]> {
    if (!this.router) {
      throw new Error('Quality queries require a DAL router with Neo4j support');
    }

    const repo = this.router.getMemoryRepository('list');
    if (!('findByMinConfidence' in repo)) {
      throw new Error('Memory repository does not support quality queries');
    }

    const result = await (repo as unknown as IMemoryRepositoryQuality).findByMinConfidence(
      groupIds,
      minLevel,
      options
    );
    return [...result.items];
  }

  /**
   * Find groups of potentially conflicting facts.
   * Routes to Neo4j repository for conflict detection.
   */
  async findConflicts(
    groupIds: readonly string[],
    topic?: string
  ): Promise<readonly IConflictGroup[]> {
    if (!this.router) {
      throw new Error('Quality queries require a DAL router with Neo4j support');
    }

    const repo = this.router.getMemoryRepository('list');
    if (!('findConflicts' in repo)) {
      throw new Error('Memory repository does not support quality queries');
    }

    return (repo as unknown as IMemoryRepositoryQuality).findConflicts(
      groupIds,
      topic
    );
  }
}
