/**
 * GitMemAdapter
 *
 * Implements Lisa's IMemoryService using git-mem's MemoryService.
 * git-mem stores memories as git notes (refs/notes/mem) with AI-* commit trailers.
 */

import {
  MemoryService as GitMemMemoryService,
  MemoryRepository,
  NotesService,
} from 'git-mem';
import type { IMemoryEntity, IMemoryQueryResult } from 'git-mem';
import type {
  IMemoryService,
  IMemoryDateOptions,
  IMemorySaveOptions,
  IMemoryItem,
  IMemoryResult,
} from '../../../domain';

/**
 * Create a git-mem MemoryService instance with default wiring.
 */
function createGitMemService(): GitMemMemoryService {
  const notesService = new NotesService();
  const repository = new MemoryRepository(notesService);
  return new GitMemMemoryService(repository);
}

/**
 * Convert a git-mem IMemoryEntity to Lisa's IMemoryItem.
 */
function toMemoryItem(entity: IMemoryEntity): IMemoryItem {
  return {
    uuid: entity.id,
    name: entity.type,
    fact: entity.content,
    tags: [...entity.tags],
    created_at: entity.createdAt,
  };
}

export class GitMemAdapter implements IMemoryService {
  private readonly gitMem: GitMemMemoryService;

  constructor(gitMem?: GitMemMemoryService) {
    this.gitMem = gitMem ?? createGitMemService();
  }

  async loadMemory(
    _timeoutMs?: number,
  ): Promise<IMemoryResult> {
    const result = this.gitMem.recall(undefined, { limit: 100 });
    return this.toMemoryResult(result);
  }

  async loadFactsDateOrdered(
    limit?: number,
    options?: IMemoryDateOptions,
  ): Promise<IMemoryItem[]> {
    const result = this.gitMem.recall(undefined, {
      limit: limit ?? 100,
      since: options?.since?.toISOString(),
    });
    return result.memories.map(toMemoryItem);
  }

  async searchFacts(
    query: string,
    limit?: number,
  ): Promise<IMemoryItem[]> {
    const result = this.gitMem.recall(query, { limit: limit ?? 20 });
    return result.memories.map(toMemoryItem);
  }

  async saveMemory(facts: readonly string[]): Promise<void> {
    for (const fact of facts) {
      this.gitMem.remember(fact);
    }
  }

  async addFact(fact: string, tags?: readonly string[]): Promise<void> {
    this.gitMem.remember(fact, {
      tags: tags ? [...tags] : undefined,
    });
  }

  async addFactWithLifecycle(
    fact: string,
    options: IMemorySaveOptions,
  ): Promise<void> {
    const tags: string[] = options.tags ? [...options.tags] : [];
    if (options.lifecycle) {
      tags.push(`lifecycle:${options.lifecycle}`);
    }
    this.gitMem.remember(fact, { tags });
  }

  async expireFact(uuid: string): Promise<void> {
    this.gitMem.delete(uuid);
  }

  async cleanupExpired(): Promise<number> {
    // git-mem doesn't have TTL-based expiration yet
    return 0;
  }

  private toMemoryResult(queryResult: IMemoryQueryResult): IMemoryResult {
    const items = queryResult.memories.map(toMemoryItem);
    const tasks = items.filter(m => m.tags?.some(t => t === 'task' || t.startsWith('status:')));
    const facts = items.filter(m => !tasks.includes(m));

    return {
      facts,
      nodes: [],
      tasks,
      initReview: null,
      timedOut: false,
    };
  }
}
