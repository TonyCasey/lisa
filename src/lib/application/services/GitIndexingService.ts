/**
 * Git Indexing Service
 *
 * Saves extracted git facts to memory with appropriate quality tags,
 * lifecycle metadata, and deduplication.
 *
 * Quality defaults:
 * - source: code-analysis
 * - confidence: from IHeuristicFact (typically medium)
 * - lifecycle: project
 *
 * Part of LISA-10: Phase 4 Indexing.
 */

import type {
  IGitIndexingService,
  IGitIndexingOptions,
  IGitIndexingResult,
  GitMemoryType,
} from '../../domain/interfaces/IGitIndexingService';
import type { IHeuristicFact } from '../../domain/interfaces/IGitExtractor';
import type { IMemoryService } from '../../domain/interfaces/IMemoryService';
import type { ILogger } from '../../domain/interfaces/ILogger';
import { COMMIT_TYPE_TO_MEMORY_TYPE } from '../../domain/interfaces/IGitIndexingService';
import { resolveSourceTag } from '../../domain/interfaces/types/IMemoryQuality';

/** Default similarity threshold for deduplication. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Simple string similarity using Jaccard index on word tokens.
 * Returns a value between 0 (no similarity) and 1 (identical).
 */
function calculateSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Build tags for a fact following LISA-10 quality defaults.
 */
function buildTags(
  fact: IHeuristicFact,
  memoryType: GitMemoryType | null
): string[] {
  const tags: string[] = [
    // Quality tags
    resolveSourceTag('code-analysis'),
    `confidence:${fact.confidence}`,
    'lifecycle:project',

    // Extraction metadata (type:heuristic-extraction needed for checkExtractedPRs dedupe)
    'type:heuristic-extraction',
    `factType:${fact.type}`,
    `factSource:${fact.source}`,
    'extractionMethod:heuristic',
  ];

  // Memory type tag (if mapped)
  if (memoryType) {
    tags.push(`memoryType:${memoryType}`);
  }

  // Linking tags
  if (fact.prNumber !== undefined) {
    tags.push(`pr:${fact.prNumber}`);
  }
  if (fact.issueNumber !== undefined) {
    tags.push(`issue:${fact.issueNumber}`);
  }
  if (fact.commitSha) {
    tags.push(`commit:${fact.commitSha}`);
  }
  if (fact.matchedPattern) {
    tags.push(`pattern:${fact.matchedPattern}`);
  }

  // Original tags from extraction (prefixed to avoid collisions)
  for (const tag of fact.tags) {
    tags.push(`tag:${tag}`);
  }

  return tags;
}

/**
 * Create a Git indexing service.
 *
 * @param memory - Memory service for saving facts
 * @param logger - Optional logger
 * @returns A Git indexing service
 */
export function createGitIndexingService(
  memory: IMemoryService,
  logger?: ILogger
): IGitIndexingService {
  return {
    async indexFacts(
      facts: readonly IHeuristicFact[],
      options: IGitIndexingOptions = {}
    ): Promise<IGitIndexingResult> {
      const {
        conventionalType,
        skipDeduplication = false,
        similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
      } = options;

      // Map conventional type to memory type
      const memoryType: GitMemoryType | null = conventionalType
        ? COMMIT_TYPE_TO_MEMORY_TYPE[conventionalType]
        : null;

      // Check if this commit type should be skipped entirely
      if (conventionalType && memoryType === null) {
        logger?.debug('Skipping indexing for commit type', { conventionalType });
        return {
          indexed: 0,
          skipped: facts.length,
          duplicates: 0,
        };
      }

      let indexed = 0;
      let skipped = 0;
      let duplicates = 0;

      // Load existing facts for deduplication
      let existingFacts: { fact?: string; text?: string }[] = [];
      if (!skipDeduplication && facts.length > 0) {
        try {
          // Search for existing facts with similar metadata
          existingFacts = await memory.searchFacts(
            'source:code-analysis extractionMethod:heuristic',
            100
          );
          logger?.debug('Loaded existing facts for deduplication', {
            count: existingFacts.length,
          });
        } catch (error) {
          // Continue without deduplication if search fails
          logger?.warn('Failed to load existing facts for deduplication', {
            error: (error as Error).message,
          });
        }
      }

      // Index each fact
      for (const fact of facts) {
        // Check for duplicates
        if (!skipDeduplication && existingFacts.length > 0) {
          const isDuplicate = existingFacts.some(existing => {
            const existingText = existing.fact || existing.text || '';
            return calculateSimilarity(existingText, fact.text) >= similarityThreshold;
          });

          if (isDuplicate) {
            logger?.debug('Skipping duplicate fact', {
              text: fact.text.substring(0, 50) + '...',
            });
            duplicates++;
            continue;
          }
        }

        // Build tags
        const tags = buildTags(fact, memoryType);

        // Save to memory with lifecycle metadata
        try {
          await memory.addFactWithLifecycle(fact.text, {
            lifecycle: 'project',
            tags,
          });
          indexed++;

          // Add to existing facts to prevent duplicates within this batch
          existingFacts.push({ fact: fact.text });

          logger?.debug('Indexed fact', {
            type: fact.type,
            memoryType,
            prNumber: fact.prNumber,
          });
        } catch (error) {
          logger?.warn('Failed to index fact', {
            error: (error as Error).message,
            text: fact.text.substring(0, 50) + '...',
          });
          skipped++;
        }
      }

      logger?.info('Git indexing complete', {
        indexed,
        skipped,
        duplicates,
        conventionalType,
        memoryType,
      });

      return { indexed, skipped, duplicates };
    },
  };
}
