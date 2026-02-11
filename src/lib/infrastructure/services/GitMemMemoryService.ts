/**
 * GitMemMemoryService
 *
 * Adapter that maps Lisa's IMemoryService interface to git-mem's MemoryService.
 * git-mem stores memories as JSON in git notes (refs/notes/mem).
 */

import type {
  IMemoryService as IGitMemMemoryService,
  IMemoryEntity,
} from 'git-mem/dist/index';

import type { IMemoryService } from '../../domain/interfaces/IMemoryService';
import type { IMemoryItem, IMemoryResult } from '../../domain/interfaces/types/IMemoryResult';
import type { IMemorySaveOptions } from '../../domain/interfaces/dal/IMemoryRepository';
import type { IMemoryDateOptions } from '../../domain/interfaces/IMemoryService';
import { resolveLifecycleTag } from '../../domain/interfaces/types/IMemoryLifecycle';
import { resolveConfidenceTag, resolveSourceTag } from '../../domain/interfaces/types/IMemoryQuality';
import type { ConfidenceLevel } from '../../domain/interfaces/types/IMemoryQuality';

/**
 * Map a git-mem IMemoryEntity to Lisa's IMemoryItem.
 */
function toMemoryItem(entity: IMemoryEntity): IMemoryItem {
  return {
    uuid: entity.id,
    name: entity.content.slice(0, 80),
    fact: entity.content,
    tags: [...entity.tags],
    created_at: entity.createdAt,
  };
}

/**
 * Build the tags array for git-mem from groupId + optional Lisa tags/options.
 */
function buildTags(
  groupId: string,
  tags?: readonly string[],
  options?: IMemorySaveOptions
): string[] {
  const result: string[] = [`group:${groupId}`];

  if (tags) {
    result.push(...tags);
  }

  if (options?.lifecycle) {
    result.push(resolveLifecycleTag(options.lifecycle));
  }

  if (options?.confidence) {
    result.push(resolveConfidenceTag(options.confidence));
  }

  if (options?.sourceType) {
    result.push(resolveSourceTag(options.sourceType));
  }

  if (options?.tags) {
    for (const tag of options.tags) {
      if (!result.includes(tag)) {
        result.push(tag);
      }
    }
  }

  return result;
}

export class GitMemMemoryService implements IMemoryService {
  constructor(private readonly gitMem: IGitMemMemoryService) {}

  async loadMemory(
    groupIds: readonly string[],
    _aliases: readonly string[],
    _branch: string | null,
    _timeoutMs?: number
  ): Promise<IMemoryResult> {
    const { memories } = this.gitMem.recall(undefined, { limit: 100 });

    const groupTags = groupIds.map(g => `group:${g}`);
    const filtered = memories.filter(m =>
      groupTags.length === 0 || m.tags.some(t => groupTags.includes(t))
    );

    const facts = filtered.map(toMemoryItem);

    // Separate init-review from facts
    const initReviewFact = facts.find(f =>
      f.tags?.some(t => t === 'init-review' || t === 'type:init-review')
    );

    return {
      facts: facts.filter(f => f !== initReviewFact),
      nodes: [],
      tasks: [],
      initReview: initReviewFact?.fact ?? null,
      timedOut: false,
    };
  }

  async loadFactsDateOrdered(
    groupIds: readonly string[],
    limit?: number,
    options?: IMemoryDateOptions
  ): Promise<IMemoryItem[]> {
    const { memories } = this.gitMem.recall(undefined, { limit: limit || 50 });

    const groupTags = groupIds.map(g => `group:${g}`);
    let filtered = memories.filter(m =>
      groupTags.length === 0 || m.tags.some(t => groupTags.includes(t))
    );

    if (options?.since) {
      const sinceTime = options.since.getTime();
      filtered = filtered.filter(m => new Date(m.createdAt).getTime() >= sinceTime);
    }

    if (options?.until) {
      const untilTime = options.until.getTime();
      filtered = filtered.filter(m => new Date(m.createdAt).getTime() <= untilTime);
    }

    return filtered.map(toMemoryItem);
  }

  async searchFacts(
    _groupIds: readonly string[],
    query: string,
    limit?: number
  ): Promise<IMemoryItem[]> {
    const { memories } = this.gitMem.recall(query, { limit: limit || 10 });
    return memories.map(toMemoryItem);
  }

  async saveMemory(groupId: string, facts: readonly string[]): Promise<void> {
    for (const fact of facts) {
      this.gitMem.remember(fact, {
        tags: [`group:${groupId}`],
      });
    }
  }

  async addFact(
    groupId: string,
    fact: string,
    tags?: readonly string[]
  ): Promise<void> {
    this.gitMem.remember(fact, {
      tags: buildTags(groupId, tags),
    });
  }

  async addFactWithLifecycle(
    groupId: string,
    fact: string,
    options: IMemorySaveOptions
  ): Promise<void> {
    const confidence = options.confidence as ConfidenceLevel | undefined;

    this.gitMem.remember(fact, {
      tags: buildTags(groupId, undefined, options),
      lifecycle: options.lifecycle,
      confidence,
    });
  }

  async expireFact(_groupId: string, uuid: string): Promise<void> {
    this.gitMem.delete(uuid);
  }

  async cleanupExpired(_groupId: string): Promise<number> {
    // git-mem doesn't support TTL-based cleanup yet
    return 0;
  }
}
