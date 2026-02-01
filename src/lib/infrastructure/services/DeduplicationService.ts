/**
 * Deduplication Detection Service.
 *
 * Infrastructure wrapper around the domain-level deduplication algorithm.
 * Loads facts and conflict groups from repositories, then delegates
 * to the pure detection functions in domain/utils/deduplication.
 *
 * Detection only — no mutations. Consolidation is handled separately.
 */

import type { IConflictGroup } from '../../domain/interfaces/dal/types';
import type {
  IDeduplicationService,
  IDeduplicationResult,
  IDeduplicationOptions,
  IDuplicateGroup,
} from '../../domain/interfaces/IDeduplicationService';
import type { IMemoryServiceWithQuality } from '../../domain/interfaces/IMemoryService';
import type { ILlmDeduplicationEnhancer } from './LlmDeduplicationEnhancer';

// Re-export pure algorithm functions from domain utils for backward compatibility
export {
  normalizeText,
  extractWords,
  jaccardSimilarity,
  detectDuplicatesFromFacts,
} from '../../domain/utils/deduplication';

/**
 * Default options for deduplication.
 */
const DEDUP_DEFAULTS: Required<IDeduplicationOptions> = {
  minSimilarity: 0.6,
  limit: 10,
  since: new Date(0), // epoch — no filter
  aiAssist: false,
};

/**
 * Create a DeduplicationService.
 *
 * @param memoryService - Memory service with quality reader (for loading facts and conflicts)
 * @param llmEnhancer - Optional LLM deduplication enhancer for semantic 4th pass
 */
export function createDeduplicationService(
  memoryService: IMemoryServiceWithQuality,
  llmEnhancer?: ILlmDeduplicationEnhancer
): IDeduplicationService {
  return {
    async detectDuplicates(
      groupId: string,
      options?: IDeduplicationOptions
    ): Promise<IDeduplicationResult> {
      const { detectDuplicatesFromFacts } = await import('../../domain/utils/deduplication');
      const opts = { ...DEDUP_DEFAULTS, ...options };

      // Load facts (up to 500)
      const dateOptions = opts.since.getTime() > 0 ? { since: opts.since } : undefined;
      const facts = await memoryService.loadFactsDateOrdered(
        [groupId],
        500,
        dateOptions
      );

      // Load conflict groups for tag overlap pass
      let conflictGroups: readonly IConflictGroup[] = [];
      try {
        conflictGroups = await memoryService.findConflicts([groupId]);
      } catch {
        // findConflicts may not be available (e.g., no Neo4j); skip Pass 2
      }

      // Passes 1-3: algorithmic deduplication
      const algorithmicGroups = detectDuplicatesFromFacts(facts, conflictGroups, opts);

      // Pass 4: optional LLM semantic deduplication
      let allGroups: readonly IDuplicateGroup[] = algorithmicGroups;
      if (llmEnhancer && opts.aiAssist) {
        try {
          const llmGroups = await llmEnhancer.findSemanticDuplicates(
            facts,
            algorithmicGroups
          );
          if (llmGroups.length > 0) {
            allGroups = [...algorithmicGroups, ...llmGroups];
          }
        } catch (_error) {
          // LLM enhancer failed; proceed with algorithmic results only
          // The enhancer logs its own failures; this is a fallback safety net
        }
      }

      // Re-sort by similarity descending and apply limit
      const sorted = [...allGroups].sort((a, b) => b.similarity - a.similarity);
      const limited = sorted.slice(0, opts.limit);

      return {
        totalFactsScanned: facts.length,
        duplicateGroups: limited,
        totalDuplicates: limited.reduce((sum, g) => sum + g.facts.length, 0),
      };
    },
  };
}
