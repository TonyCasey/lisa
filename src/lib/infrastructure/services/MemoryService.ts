import type {
  IMemoryService,
  IMcpClient,
  IMemoryResult,
  IMemoryItem,
  ILogger,
  IMemoryResultBuilder,
  IStructuredLogger,
  ILogContext,
} from '../../domain';
import {
  createMemoryResultBuilder,
  withCancellation,
  checkCancellation,
  isCancellationError,
  LogEvents,
} from '../../domain';
import { ContextDetector } from '../context';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
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
export class MemoryService implements IMemoryService {
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
   * Load facts using DAL router with date ordering.
   * This is an optimized path for simple listing without aliases.
   *
   * @param groupIds - Group IDs to query
   * @param limit - Maximum number of facts to return
   */
  async loadFactsDateOrdered(
    groupIds: readonly string[],
    limit: number = 50
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
      const facts = response?.result?.facts || response?.facts || [];
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
      const sorted = [...result.items].sort((a, b) => {
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
}
