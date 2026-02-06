/**
 * MemoryContextLoader
 *
 * Loads memory context from git-mem.
 * Queries facts, init-review, and tasks via the IMemoryService and ITaskService adapters.
 *
 * Extracted from SessionStartHandler to isolate memory loading strategy.
 */

import type {
  IMemoryService,
  ITaskService,
  ILogger,
  IMemoryDateOptions,
} from '../../domain';
import type { IMemoryItem } from '../../domain/interfaces/types/IMemoryResult';
import {
  withCancellation,
  checkCancellation,
  isCancellationError,
} from '../../domain';

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
    private readonly logger?: ILogger,
  ) {}

  /**
   * Load memory context from git-mem.
   */
  async loadMemory(
    hierarchicalGroupIds: readonly string[],
    projectAliases: readonly string[],
    _branch: string | null,
    dateOptions?: IMemoryDateOptions,
  ): Promise<IMemoryLoadResult> {
    const result: IMemoryLoadResult = {
      facts: [],
      nodes: [],
      tasks: [],
      initReview: null,
      timedOut: false,
    };

    const TIMEOUT_MS = 5000;
    const allGroupIds = [...new Set([...hierarchicalGroupIds, ...projectAliases])];

    const cancellableResult = await withCancellation(
      async (abortSignal) => {
        // Load init-review
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before init-review');

          const initFacts = await this.memory.searchFacts(allGroupIds, 'init-review', 1);

          checkCancellation(abortSignal, 'Memory load cancelled after init-review fetch');

          const initFact = initFacts.find((f) => f.tags?.includes('type:init-review'));
          if (initFact) {
            result.initReview = initFact.fact || initFact.name || null;
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
        }

        // Load facts with date ordering
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before facts');

          const facts = await this.memory.loadFactsDateOrdered(allGroupIds, 100, dateOptions);

          checkCancellation(abortSignal, 'Memory load cancelled after facts fetch');

          result.facts = facts;
        } catch (error) {
          if (isCancellationError(error)) throw error;
        }

        // Load tasks
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before tasks');

          const loadedTasks = await this.tasks.getTasksSimple(allGroupIds);

          checkCancellation(abortSignal, 'Memory load cancelled after tasks fetch');

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
        }

        return result;
      },
      {
        timeoutMs: TIMEOUT_MS,
        onCancel: () => {
          this.logger?.debug('Memory load cancelled');
        },
      }
    );

    result.timedOut = cancellableResult.timedOut;

    return result;
  }
}
