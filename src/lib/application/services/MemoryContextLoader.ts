/**
 * MemoryContextLoader
 *
 * Loads memory context using the DAL router for optimal date ordering.
 * Uses Neo4j for date-ordered facts, MCP for init-review and tasks.
 *
 * Extracted from SessionStartHandler to isolate memory loading strategy.
 */

import type {
  IMemoryService,
  ITaskService,
  IMcpClient,
  IMemoryItem,
  ILogger,
  IMemoryDateOptions,
} from '../../domain';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import {
  withCancellation,
  checkCancellation,
  isCancellationError,
} from '../../domain';
import { parseConfidenceTag, parseSourceTag } from '../../domain/interfaces/types/IMemoryQuality';

interface IMcpNodeResponse {
  result?: {
    nodes?: IMemoryItem[];
  };
  nodes?: IMemoryItem[];
}

export interface IMemoryLoadResult {
  facts: IMemoryItem[];
  nodes: IMemoryItem[];
  tasks: IMemoryItem[];
  initReview: string | null;
  timedOut: boolean;
}

export class MemoryContextLoader {
  constructor(
    private readonly memory: IMemoryService,
    private readonly tasks: ITaskService,
    private readonly mcp: IMcpClient,
    private readonly router?: IRepositoryRouter,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Load memory using the optimal strategy (DAL or MCP fallback).
   */
  async loadMemory(
    hierarchicalGroupIds: readonly string[],
    projectAliases: readonly string[],
    branch: string | null,
    dateOptions?: IMemoryDateOptions,
  ): Promise<IMemoryLoadResult> {
    if (this.router && this.router.isBackendAvailable('neo4j')) {
      return this.loadMemoryWithDAL(hierarchicalGroupIds, projectAliases, branch, undefined, dateOptions);
    }
    // Fall back to MCP-only path
    const result = await this.memory.loadMemory(
      hierarchicalGroupIds,
      projectAliases,
      branch,
      5000 // 5 second timeout
    );
    return result as IMemoryLoadResult;
  }

  /**
   * Load memory using the DAL router for optimal date ordering.
   * Uses AbortController-based cancellation to ensure no mutations
   * occur after timeout and resources are properly cleaned up.
   */
  private async loadMemoryWithDAL(
    hierarchicalGroupIds: readonly string[],
    projectAliases: readonly string[],
    branch: string | null,
    signal?: AbortSignal,
    dateOptions?: IMemoryDateOptions
  ): Promise<IMemoryLoadResult> {
    const memory = this.memory;
    const mcp = this.mcp;
    const result: IMemoryLoadResult = {
      facts: [],
      nodes: [],
      tasks: [],
      initReview: null,
      timedOut: false,
    };

    const TIMEOUT_MS = 5000;

    // Combine hierarchical group IDs with project aliases for comprehensive search
    const allGroupIds = [...new Set([...hierarchicalGroupIds, ...projectAliases])];

    const cancellableResult = await withCancellation(
      async (abortSignal) => {
        // Load init-review via MCP (semantic search for specific tag)
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before init-review');

          const initFacts = await memory.searchFacts(allGroupIds, 'init-review', 1);

          checkCancellation(abortSignal, 'Memory load cancelled after init-review fetch');

          const initFact = initFacts.find((f) => f.tags?.includes('type:init-review'));
          if (initFact) {
            result.initReview = initFact.fact || initFact.name || null;
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if init-review load fails
        }

        // Load facts using DAL with date ordering (Neo4j preferred)
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before facts');

          const facts = await memory.loadFactsDateOrdered(allGroupIds, 60, dateOptions);

          checkCancellation(abortSignal, 'Memory load cancelled after facts fetch');

          result.facts = facts;
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if fact load fails
        }

        // Fall back to nodes when no facts are found (preserve MCP behavior)
        if (!result.facts.length) {
          try {
            const seenUuids = new Set<string>();

            for (const alias of projectAliases) {
              checkCancellation(abortSignal, 'Memory load cancelled during node iteration');

              const nodeParams = {
                query: alias,
                tags: this.buildRepoTags(alias, branch),
                max_nodes: 20,
                group_ids: [...allGroupIds],
              };
              const [nodeResp] = await mcp.call<IMcpNodeResponse>('search_nodes', nodeParams);

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
          } catch (error) {
            if (isCancellationError(error)) throw error;
            // Continue if node load fails
          }
        }

        // Load tasks via DAL (uses Neo4j when available for date ordering)
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before tasks');

          const loadedTasks = await this.tasks.getTasksSimple(allGroupIds);

          checkCancellation(abortSignal, 'Memory load cancelled after tasks fetch');

          // Convert ITask[] to IMemoryItem[] format for compatibility
          for (const task of loadedTasks) {
            result.tasks.push({
              uuid: task.key,
              name: task.title,
              fact: task.title,
              tags: [
                'type:task',
                `task_id:${task.key}`,
                `status:${task.status}`,
                ...(task.blocked || []).map((b: string) => `blocked_by:${b}`),
              ],
              created_at: task.created_at,
            });
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if task load fails
        }

        return result;
      },
      {
        timeoutMs: TIMEOUT_MS,
        signal,
        onCancel: () => {
          this.logger?.debug('Memory load with DAL cancelled');
        },
      }
    );

    result.timedOut = cancellableResult.timedOut;

    return result;
  }

  /**
   * Rank and select the most valuable facts using a 6-tier priority algorithm.
   *
   * Tiers (filled top-down until budget exhausted):
   * 1. confidence:verified — always included
   * 2. source:user-explicit — always included
   * 3. confidence:high + within 48h — up to 15
   * 4. Active tasks (type:task, status not done) — up to 10
   * 5. confidence:medium + within 24h — up to 5
   * 6. Everything else by date — fills remaining budget
   *
   * @param facts - All loaded facts
   * @param recentFilePaths - Optional file paths for file-aware boost
   * @returns Ranked and capped facts (max RANKING_BUDGET)
   */
  rankAndSelectFacts(
    facts: IMemoryItem[],
    recentFilePaths?: readonly string[]
  ): IMemoryItem[] {
    const BUDGET = 30;
    const TIER3_CAP = 15;
    const TIER4_CAP = 10;
    const TIER5_CAP = 5;

    const now = Date.now();
    const hours48 = 48 * 60 * 60 * 1000;
    const hours24 = 24 * 60 * 60 * 1000;

    const filePathSet = new Set(recentFilePaths?.map(f => f.toLowerCase()) ?? []);

    // Assign each fact to a tier
    const tiers: IMemoryItem[][] = [[], [], [], [], [], []]; // T1..T6

    for (const fact of facts) {
      const tags = fact.tags ?? [];
      const confidence = parseConfidenceTag(tags);
      const source = parseSourceTag(tags);
      const age = fact.created_at ? now - new Date(fact.created_at).getTime() : Infinity;
      const isTask = tags.some(t => t === 'type:task');
      const isActiveTask = isTask && !tags.some(t => t === 'status:done' || t === 'status:closed');

      // File-aware boost: promote facts mentioning recent files to T3
      // Only boost facts that would otherwise land in T4-T6 (preserve T1/T2 priority)
      if (filePathSet.size > 0 && fact.fact && confidence !== 'verified' && source !== 'user-explicit') {
        const factLower = fact.fact.toLowerCase();
        let boosted = false;
        for (const fp of filePathSet) {
          if (factLower.includes(fp)) {
            tiers[2].push(fact); // Boost to T3
            boosted = true;
            break;
          }
        }
        if (boosted) continue;
      }

      if (confidence === 'verified') {
        tiers[0].push(fact);
      } else if (source === 'user-explicit') {
        tiers[1].push(fact);
      } else if (confidence === 'high' && age <= hours48) {
        tiers[2].push(fact);
      } else if (isActiveTask) {
        tiers[3].push(fact);
      } else if (confidence === 'medium' && age <= hours24) {
        tiers[4].push(fact);
      } else {
        tiers[5].push(fact);
      }
    }

    // Fill from tiers, respecting caps
    const selected: IMemoryItem[] = [];
    const tierCaps = [Infinity, Infinity, TIER3_CAP, TIER4_CAP, TIER5_CAP, Infinity];

    for (let t = 0; t < tiers.length; t++) {
      if (selected.length >= BUDGET) break;
      const remaining = BUDGET - selected.length;
      const cap = Math.min(tierCaps[t], remaining);
      selected.push(...tiers[t].slice(0, cap));
    }

    return selected;
  }

  private buildRepoTags(repo: string, branch: string | null): string[] {
    const tags: string[] = [];
    if (repo) tags.push(`repo:${repo}`);
    if (branch) tags.push(`branch:${branch}`);
    return tags;
  }
}
