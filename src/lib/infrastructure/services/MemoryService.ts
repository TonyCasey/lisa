import type { IMemoryService, IMcpClient, IMemoryResult, IMemoryItem, ILogger } from '../../domain';
import { emptyMemoryResult } from '../../domain';
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

  constructor(
    private readonly mcp: IMcpClient,
    private readonly router?: IRepositoryRouter,
    logger?: ILogger
  ) {
    this.logger = logger ?? new NullLogger();
  }

  /**
   * Load memory for a group, querying hierarchically.
   */
  async loadMemory(
    groupIds: readonly string[],
    aliases: readonly string[],
    branch: string | null,
    timeoutMs: number = MEMORY_LOAD_TIMEOUT_MS
  ): Promise<IMemoryResult> {
    this.logger.debug('Loading memory', { groupIds, aliases, branch, timeoutMs });
    
    const result = emptyMemoryResult();
    const mutableResult = result as {
      facts: IMemoryItem[];
      nodes: IMemoryItem[];
      tasks: IMemoryItem[];
      initReview: string | null;
      timedOut: boolean;
    };

    let sessionId: string | null = null;
    let timedOut = false;

    const loadPromise = async (): Promise<void> => {
      // Load init-review memory first (codebase summary)
      try {
        const initParams = {
          query: 'init-review',
          max_facts: 1,
          order: 'desc',
          group_ids: [...groupIds],
          tags: ['type:init-review'],
        };
        const [initResp, sid] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', initParams, sessionId);
        sessionId = sid;

        const initFacts = initResp?.result?.facts || initResp?.facts || [];
        if (initFacts.length > 0) {
          const fact = initFacts[0];
          mutableResult.initReview = fact?.fact || fact?.name || null;
          this.logger.debug('Loaded init-review');
        }
      } catch (error) {
        this.logger.debug('Failed to load init-review', { error: (error as Error).message });
      }

      // Load recent facts/nodes from memory using hierarchical groups
      try {
        const seenUuids = new Set<string>();

        // Query with hierarchical groups
        const recentParams = {
          query: '*',
          max_facts: 100,
          order: 'desc',
          group_ids: [...groupIds],
        };
        const [recentResp, sid] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', recentParams, sessionId);
        sessionId = sid;

        const recentFacts = recentResp?.result?.facts || recentResp?.facts || [];
        for (const fact of recentFacts) {
          const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
          if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            mutableResult.facts.push(fact);
          }
        }

        // Also query by repo aliases
        for (const alias of aliases) {
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
          const [factResp] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', factParams, sessionId);

          const aliasedFacts = factResp?.result?.facts || factResp?.facts || [];
          for (const fact of aliasedFacts) {
            const uuid = fact.uuid || `${fact.name}-${fact.fact}`;
            if (!seenUuids.has(uuid)) {
              seenUuids.add(uuid);
              mutableResult.facts.push(fact);
            }
          }
        }

        // Fall back to nodes if no facts found
        if (!mutableResult.facts.length) {
          for (const alias of aliases) {
            const baseParams = {
              query: alias,
              tags: ContextDetector.repoTags({ repo: alias, branch }),
            };
            const nodeParams = {
              ...baseParams,
              max_nodes: 20,
              group_ids: [...groupIds],
            };
            const [nodeResp] = await this.mcp.call<McpMemoryResponse>('search_nodes', nodeParams, sessionId);
            const aliasedNodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
            for (const node of aliasedNodes) {
              const uuid = node.uuid || `${node.name}-${node.fact}`;
              if (!seenUuids.has(uuid)) {
                seenUuids.add(uuid);
                mutableResult.nodes.push(node);
              }
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to load memory facts', { error: (error as Error).message });
      }

      // Load tasks for this repo
      try {
        const seenTaskUuids = new Set<string>();

        for (const alias of aliases) {
          const taskParams = {
            query: 'task',
            tags: ['type:task', ...ContextDetector.repoTags({ repo: alias, branch })],
            max_nodes: 200,
            group_ids: [...groupIds],
          };
          const [taskResp] = await this.mcp.call<McpMemoryResponse>('search_nodes', taskParams, sessionId);
          const aliasedTasks = taskResp?.result?.nodes || taskResp?.nodes || [];
          for (const task of aliasedTasks) {
            const uuid = task.uuid || `${task.name}-${task.fact}`;
            if (!seenTaskUuids.has(uuid)) {
              seenTaskUuids.add(uuid);
              mutableResult.tasks.push(task);
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to load tasks', { error: (error as Error).message });
      }
    };

    // Race between loading and timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });

    await Promise.race([loadPromise(), timeoutPromise]);

    mutableResult.timedOut = timedOut;
    
    this.logger.info('Memory loaded', {
      factsCount: mutableResult.facts.length,
      nodesCount: mutableResult.nodes.length,
      tasksCount: mutableResult.tasks.length,
      hasInitReview: !!mutableResult.initReview,
      timedOut,
    });
    
    return mutableResult;
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
    this.logger.debug('Adding fact', { groupId, factLength: fact.length, tags });
    
    // Use DAL router if available for writes
    if (this.router) {
      try {
        const repo = this.router.getMemoryRepository('write');
        if ('save' in repo) {
          await repo.save(groupId, fact, { tags });
          this.logger.debug('Fact saved via DAL router');
          return;
        }
      } catch (error) {
        this.logger.debug('DAL router write failed, falling back to MCP', { 
          error: (error as Error).message 
        });
      }
    }

    await this.mcp.call('add_memory', {
      content: fact,
      group_ids: [groupId],
      tags: [...tags],
    });
    this.logger.debug('Fact saved via MCP');
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
    this.logger.debug('Loading facts date-ordered', { groupIds, limit });
    
    if (!this.router) {
      // Fall back to MCP-only path
      this.logger.debug('Using MCP-only path (no router)');
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
      this.logger.debug('Loaded facts via MCP', { count: sorted.length });
      return sorted;
    }

    // Use DAL router - prefer Neo4j for date-ordered listing
    try {
      const repo = this.router.getMemoryRepository('list');
      const result = await repo.findByGroupIds(groupIds, {
        sort: { field: 'created_at', order: 'desc' },
        limit,
      });
      this.logger.debug('Loaded facts via DAL router (list)', { count: result.items.length });
      return [...result.items];
    } catch (error) {
      // Fall back to MCP
      this.logger.debug('DAL list failed, falling back to search', { error: (error as Error).message });
      const repo = this.router.getMemoryRepository('search');
      const result = await repo.findByGroupIds(groupIds, { limit });
      const sorted = [...result.items].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      this.logger.debug('Loaded facts via DAL router (search)', { count: sorted.length });
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
    this.logger.debug('Searching facts', { groupIds, query, limit });
    
    if (!this.router) {
      // Fall back to MCP-only path
      const [response] = await this.mcp.call<McpMemoryResponse>('search_memory_facts', {
        query,
        max_facts: limit,
        group_ids: [...groupIds],
      });
      const facts = response?.result?.facts || response?.facts || [];
      this.logger.debug('Search completed via MCP', { resultsCount: facts.length });
      return facts;
    }

    // Use DAL router - prefer MCP for semantic search
    try {
      const repo = this.router.getMemoryRepository('search');
      const result = await repo.findByGroupIds(groupIds, { query, limit });
      this.logger.debug('Search completed via DAL router', { resultsCount: result.items.length });
      return [...result.items];
    } catch (error) {
      this.logger.warn('Search failed', { error: (error as Error).message });
      return [];
    }
  }
}
