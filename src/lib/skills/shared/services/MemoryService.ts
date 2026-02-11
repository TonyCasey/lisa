/**
 * Memory service implementation for skill scripts.
 * Uses git-mem for all memory operations.
 */
import type { IMemoryService as IGitMemMemoryService, IMemoryEntity } from 'git-mem/dist/index';

import type {
  IMemoryService,
  IFact,
  IMemoryLoadResult,
  IMemoryAddResult,
  IMemoryAddOptions,
  IMemoryLoadOptions,
  IMemoryExpireResult,
  IMemoryCleanupResult,
  IMemoryConflictsResult,
  IMemoryDedupeResult,
  IMemoryCurateResult,
  IMemoryConsolidateResult,
  IConflictGroup,
} from './interfaces';
import { detectDuplicatesFromFacts } from '../../../domain/utils/deduplication';
import { isValidCurationMark, resolveCurationTag } from '../../../domain/interfaces/ICurationService';
import type { CurationMark } from '../../../domain/interfaces/ICurationService';
import { resolveConfidenceTag } from '../../../domain/interfaces/types/IMemoryQuality';
import { CONSOLIDATION_ACTION_VALUES } from '../../../domain/interfaces/IConsolidationService';
import type { ConsolidationAction } from '../../../domain/interfaces/IConsolidationService';

/**
 * Type-to-tag mapping for memory types.
 */
const TYPE_TAG_MAP: Record<string, string> = {
  decision: 'DECISION',
  pattern: 'PATTERN',
  bug: 'BUG',
  milestone: 'MILESTONE',
  feature: 'FEATURE',
  refactor: 'REFACTOR',
  context: 'CONTEXT',
  learning: 'LEARNING',
};

/**
 * Resolve a tag from the memory type or explicit tag.
 */
function resolveTag(text: string, options: IMemoryAddOptions): string | undefined {
  if (options.tag) return options.tag;

  if (options.type && TYPE_TAG_MAP[options.type.toLowerCase()]) {
    return TYPE_TAG_MAP[options.type.toLowerCase()];
  }

  const prefixMatch = text.match(/^([A-Z_]+):\s*/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  return undefined;
}

/**
 * Map a git-mem IMemoryEntity to the skills IFact.
 */
function toFact(entity: IMemoryEntity, groupId: string): IFact {
  return {
    uuid: entity.id,
    name: entity.content.slice(0, 80),
    fact: entity.content,
    group_id: groupId,
    created_at: entity.createdAt,
  };
}

/**
 * Dependencies for creating a memory service.
 */
export interface IMemoryServiceDependencies {
  gitMem: IGitMemMemoryService;
}

/**
 * Creates a memory service instance backed by git-mem.
 *
 * @param deps - Service dependencies
 * @returns Memory service implementation
 */
export function createMemoryService(deps: IMemoryServiceDependencies): IMemoryService {
  const { gitMem } = deps;

  return {
    async load(
      groupIds: string[],
      query: string,
      limit: number,
      options?: IMemoryLoadOptions
    ): Promise<IMemoryLoadResult> {
      const searchQuery = (query && query !== '*') ? query : undefined;
      const { memories } = gitMem.recall(searchQuery, { limit });

      // Client-side group filtering via tags
      const groupTags = groupIds.map(g => `group:${g}`);
      let filtered = memories.filter(m =>
        groupTags.length === 0 || m.tags.some(t => groupTags.includes(t))
      );

      // Client-side date filtering
      if (options?.since) {
        const sinceTime = options.since.getTime();
        filtered = filtered.filter(m => new Date(m.createdAt).getTime() >= sinceTime);
      }
      if (options?.until) {
        const untilTime = options.until.getTime();
        filtered = filtered.filter(m => new Date(m.createdAt).getTime() <= untilTime);
      }

      const facts: IFact[] = filtered.map(m => toFact(m, groupIds[0] || ''));

      return {
        status: 'ok',
        action: 'load',
        group: groupIds[0] || '',
        groups: groupIds,
        query: query || '',
        facts,
        mode: 'git-mem',
      };
    },

    async add(
      text: string,
      groupId: string,
      options: IMemoryAddOptions
    ): Promise<IMemoryAddResult> {
      const tag = resolveTag(text, options);

      const tags: string[] = [`group:${groupId}`];
      if (tag) {
        // Tags containing ':' are namespaced, store as-is.
        // Simple tags get 'type:' prefix.
        const mcpTag = tag.includes(':') ? tag.toLowerCase() : `type:${tag.toLowerCase()}`;
        tags.push(mcpTag);
      }

      gitMem.remember(text, { tags });

      return {
        status: 'ok',
        action: 'add',
        group: groupId,
        text,
        tag,
        mode: 'git-mem',
      };
    },

    async expire(
      groupId: string,
      uuid: string
    ): Promise<IMemoryExpireResult> {
      const found = gitMem.delete(uuid);

      return {
        status: 'ok',
        action: 'expire',
        group: groupId,
        uuid,
        found,
        mode: 'git-mem',
      };
    },

    async cleanup(
      groupId: string,
      _dryRun: boolean
    ): Promise<IMemoryCleanupResult> {
      // git-mem doesn't support TTL-based cleanup yet
      return {
        status: 'ok',
        action: 'cleanup',
        group: groupId,
        expiredCount: 0,
        dryRun: _dryRun,
        mode: 'git-mem',
      };
    },

    async conflicts(
      groupIds: string[],
      topic?: string
    ): Promise<IMemoryConflictsResult> {
      const { memories } = gitMem.recall(undefined, { limit: 200 });

      // Filter by group
      const groupTags = groupIds.map(g => `group:${g}`);
      const filtered = memories.filter(m =>
        groupTags.length === 0 || m.tags.some(t => groupTags.includes(t))
      );

      // Group by type:* tags
      const typeGroups = new Map<string, IFact[]>();
      for (const m of filtered) {
        const typeTags = m.tags.filter(t => t.startsWith('type:'));
        for (const typeTag of typeTags) {
          if (topic && typeTag !== topic) continue;
          const existing = typeGroups.get(typeTag) || [];
          existing.push(toFact(m, groupIds[0] || ''));
          typeGroups.set(typeTag, existing);
        }
      }

      // Only keep groups with >1 fact (potential conflicts)
      const conflictGroups: IConflictGroup[] = [];
      for (const [topicTag, facts] of typeGroups) {
        if (facts.length > 1) {
          conflictGroups.push({
            topic: topicTag,
            facts,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      return {
        status: 'ok',
        action: 'conflicts',
        group: groupIds[0] || '',
        groups: groupIds,
        topic: topic || '',
        conflictGroups,
        totalConflicts: conflictGroups.length,
        mode: 'git-mem',
      };
    },

    async dedupe(
      groupId: string,
      options?: { minSimilarity?: number; limit?: number; since?: Date }
    ): Promise<IMemoryDedupeResult> {
      const minSimilarity = options?.minSimilarity ?? 0.6;
      const limit = options?.limit ?? 10;

      const { memories } = gitMem.recall(undefined, { limit: 500 });

      // Filter by group and date
      const groupTag = `group:${groupId}`;
      let filtered = memories.filter(m => m.tags.includes(groupTag));

      if (options?.since) {
        const sinceTime = options.since.getTime();
        filtered = filtered.filter(m => new Date(m.createdAt).getTime() >= sinceTime);
      }

      const facts = filtered.map(m => ({
        uuid: m.id,
        name: m.content.slice(0, 80),
        fact: m.content,
        created_at: m.createdAt,
      }));

      // Build conflict groups for tag overlap pass
      const typeGroups = new Map<string, typeof facts>();
      for (const m of filtered) {
        const typeTags = m.tags.filter(t => t.startsWith('type:'));
        for (const typeTag of typeTags) {
          const existing = typeGroups.get(typeTag) || [];
          existing.push({
            uuid: m.id,
            name: m.content.slice(0, 80),
            fact: m.content,
            created_at: m.createdAt,
          });
          typeGroups.set(typeTag, existing);
        }
      }

      const conflictGroups = [...typeGroups.entries()]
        .filter(([, groupFacts]) => groupFacts.length > 1)
        .map(([topicTag, groupFacts]) => ({
          topic: topicTag,
          facts: groupFacts,
          detectedAt: new Date().toISOString(),
        }));

      // Run the three-pass detection algorithm
      const duplicateGroups = detectDuplicatesFromFacts(facts, conflictGroups, {
        minSimilarity,
        limit,
      });

      const skillGroups = duplicateGroups.map(g => ({
        reason: g.reason,
        facts: g.facts.map(f => ({
          uuid: f.uuid ?? '',
          name: f.name ?? '',
          fact: f.fact ?? '',
          group_id: groupId,
          created_at: f.created_at ?? '',
        })),
        similarity: g.similarity,
      }));

      const totalDuplicates = skillGroups.reduce((sum, group) => sum + group.facts.length, 0);

      return {
        status: 'ok',
        action: 'dedupe',
        group: groupId,
        totalFactsScanned: facts.length,
        duplicateGroups: skillGroups,
        totalDuplicates,
        minSimilarity,
        mode: 'git-mem',
      };
    },

    async curate(
      groupId: string,
      uuid: string,
      mark: CurationMark
    ): Promise<IMemoryCurateResult> {
      if (!isValidCurationMark(mark)) {
        throw new Error(`Invalid curation mark: "${mark}". Valid marks: authoritative, draft, deprecated, needs-review`);
      }

      // For git-mem: recall, find by uuid, delete, re-remember with updated tags
      const { memories } = gitMem.recall(undefined, { limit: 500 });
      const existing = memories.find(m => m.id === uuid);

      if (!existing) {
        throw new Error(`Fact not found: uuid="${uuid}" in group="${groupId}"`);
      }

      const curationTag = resolveCurationTag(mark);
      const newTags = existing.tags.filter(t => !t.startsWith('curated:'));
      newTags.push(curationTag);

      if (mark === 'authoritative') {
        // Also promote confidence
        const confidenceTag = resolveConfidenceTag('verified');
        const filteredTags = newTags.filter(t => !t.startsWith('confidence:'));
        filteredTags.push(confidenceTag);
        // Delete and re-remember
        gitMem.delete(uuid);
        gitMem.remember(existing.content, { tags: filteredTags });
      } else if (mark === 'deprecated') {
        // Just delete the fact (equivalent to expire)
        gitMem.delete(uuid);
      } else {
        // draft / needs-review: update tags
        gitMem.delete(uuid);
        gitMem.remember(existing.content, { tags: [...newTags] });
      }

      return {
        status: 'ok',
        action: 'curate',
        group: groupId,
        uuid,
        mark,
        mode: 'git-mem',
      };
    },

    async consolidate(
      groupId: string,
      factUuids: string[],
      action: ConsolidationAction,
      options?: { retainUuid?: string; mergedText?: string }
    ): Promise<IMemoryConsolidateResult> {
      if (!CONSOLIDATION_ACTION_VALUES.includes(action)) {
        throw new Error(`Invalid consolidation action: "${action}". Valid actions: merge, archive-duplicates, keep-all`);
      }
      if (factUuids.length < 2) {
        throw new Error('Consolidation requires at least 2 fact UUIDs');
      }
      if (options?.retainUuid && !factUuids.includes(options.retainUuid)) {
        throw new Error(`retainUuid "${options.retainUuid}" is not in the provided fact UUIDs`);
      }

      if (action === 'keep-all') {
        return {
          status: 'ok',
          action: 'consolidate',
          group: groupId,
          consolidationAction: 'keep-all',
          retainedUuid: factUuids[0] ?? '',
          archivedUuids: [],
          relationshipsCreated: 0,
          mode: 'git-mem',
        };
      }

      if (action === 'merge') {
        const mergedText = options?.mergedText;
        if (!mergedText) {
          throw new Error('merge action requires --text with merged text');
        }

        // Add merged fact
        gitMem.remember(mergedText, {
          tags: [`group:${groupId}`, 'source:consolidation'],
        });

        // Delete all originals
        for (const uuid of factUuids) {
          gitMem.delete(uuid);
        }

        return {
          status: 'ok',
          action: 'consolidate',
          group: groupId,
          consolidationAction: 'merge',
          retainedUuid: 'new-merged-fact',
          archivedUuids: [...factUuids],
          relationshipsCreated: 0,
          mode: 'git-mem',
        };
      }

      // archive-duplicates
      const retainUuid = options?.retainUuid ?? factUuids[0] ?? '';
      const archiveUuids = factUuids.filter(uuid => uuid !== retainUuid);

      for (const uuid of archiveUuids) {
        gitMem.delete(uuid);
      }

      return {
        status: 'ok',
        action: 'consolidate',
        group: groupId,
        consolidationAction: 'archive-duplicates',
        retainedUuid: retainUuid,
        archivedUuids: archiveUuids,
        relationshipsCreated: 0,
        mode: 'git-mem',
      };
    },
  };
}
