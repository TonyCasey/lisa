/**
 * Deduplication Detection Service.
 *
 * Detects duplicate memory facts using a three-pass algorithm:
 * 1. Exact match — identical normalized text
 * 2. Tag overlap — same type:* tag with shared words (via findConflicts)
 * 3. Similar content — Jaccard word-set similarity
 *
 * Detection only — no mutations. Consolidation is handled separately.
 */

import type { IMemoryItem } from '../../domain/interfaces/types';
import type { IConflictGroup } from '../../domain/interfaces/dal/types';
import type {
  IDeduplicationService,
  IDeduplicationResult,
  IDeduplicationOptions,
  IDuplicateGroup,
} from '../../domain/interfaces/IDeduplicationService';
import type { IMemoryServiceWithQuality } from '../../domain/interfaces/IMemoryService';

/**
 * Common English stop words to exclude from word-set comparisons.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'same', 'than', 'too', 'very',
  'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
]);

/**
 * Normalize text for comparison: lowercase, trim, collapse whitespace.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract meaningful words from text, removing stop words.
 * Returns a set of lowercase words.
 */
export function extractWords(text: string): Set<string> {
  const words = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Compute Jaccard similarity between two word sets.
 * Returns |A ∩ B| / |A ∪ B|, or 0 if both sets are empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect duplicates from a pre-loaded array of facts.
 * Exported for reuse by skill-level services.
 *
 * @param facts - Array of memory items to scan
 * @param conflictGroups - Pre-fetched conflict groups (for tag overlap pass)
 * @param options - Detection options
 */
export function detectDuplicatesFromFacts(
  facts: readonly IMemoryItem[],
  conflictGroups: readonly IConflictGroup[],
  options: IDeduplicationOptions = {}
): IDuplicateGroup[] {
  const { minSimilarity = 0.6, limit = 10 } = options;

  const groups: IDuplicateGroup[] = [];
  const claimed = new Set<string>(); // Track facts already in a group (by uuid)

  // Pass 1: Exact match — group by normalized fact text
  const normalizedMap = new Map<string, IMemoryItem[]>();
  for (const fact of facts) {
    if (!fact.fact || !fact.uuid) continue;
    const key = normalizeText(fact.fact);
    const existing = normalizedMap.get(key);
    if (existing) {
      existing.push(fact);
    } else {
      normalizedMap.set(key, [fact]);
    }
  }

  for (const members of normalizedMap.values()) {
    if (members.length < 2) continue;
    for (const m of members) {
      if (m.uuid) claimed.add(m.uuid);
    }
    groups.push({
      reason: 'exact-match',
      facts: members,
      similarity: 1.0,
    });
  }

  // Pass 2: Tag overlap — use conflict groups (facts sharing type:* tags)
  for (const cg of conflictGroups) {
    // Filter out already-claimed facts
    const unclaimed = cg.facts.filter(
      (f) => f.uuid && !claimed.has(f.uuid)
    );
    if (unclaimed.length < 2) continue;

    // Check pairwise word overlap — need 3+ common words
    const wordSets = unclaimed.map((f) => ({
      fact: f,
      words: extractWords(f.fact ?? ''),
    }));

    const tagGroup: IMemoryItem[] = [];
    let maxOverlapRatio = 0;

    for (let i = 0; i < wordSets.length; i++) {
      for (let j = i + 1; j < wordSets.length; j++) {
        const a = wordSets[i];
        const b = wordSets[j];
        let commonCount = 0;
        for (const w of a.words) {
          if (b.words.has(w)) commonCount++;
        }
        if (commonCount >= 3) {
          if (!tagGroup.includes(a.fact)) tagGroup.push(a.fact);
          if (!tagGroup.includes(b.fact)) tagGroup.push(b.fact);
          const ratio = jaccardSimilarity(a.words, b.words);
          if (ratio > maxOverlapRatio) maxOverlapRatio = ratio;
        }
      }
    }

    if (tagGroup.length >= 2) {
      // Scale similarity: 0.5 base + ratio contribution (cap at 0.8)
      const similarity = Math.min(0.5 + maxOverlapRatio * 0.3, 0.8);
      for (const f of tagGroup) {
        if (f.uuid) claimed.add(f.uuid);
      }
      groups.push({
        reason: 'tag-overlap',
        facts: tagGroup,
        similarity: Math.round(similarity * 100) / 100,
      });
    }
  }

  // Pass 3: Similar content — Jaccard similarity on unclaimed facts
  const unclaimed = facts.filter(
    (f) => f.uuid && f.fact && !claimed.has(f.uuid)
  );

  if (unclaimed.length >= 2) {
    const wordSets = unclaimed.map((f) => ({
      fact: f,
      words: extractWords(f.fact ?? ''),
    }));

    // Build adjacency: pair facts with similarity >= threshold
    const adjacency = new Map<number, number[]>();
    const pairSimilarities = new Map<string, number>();

    for (let i = 0; i < wordSets.length; i++) {
      for (let j = i + 1; j < wordSets.length; j++) {
        const sim = jaccardSimilarity(wordSets[i].words, wordSets[j].words);
        if (sim >= minSimilarity) {
          const key = `${i}:${j}`;
          pairSimilarities.set(key, sim);
          if (!adjacency.has(i)) adjacency.set(i, []);
          if (!adjacency.has(j)) adjacency.set(j, []);
          adjacency.get(i)!.push(j);
          adjacency.get(j)!.push(i);
        }
      }
    }

    // Build transitive groups via BFS
    const visited = new Set<number>();
    for (const [start] of adjacency) {
      if (visited.has(start)) continue;
      const queue = [start];
      const component: number[] = [];
      let maxSim = 0;

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        component.push(node);
        for (const neighbor of adjacency.get(node) ?? []) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
          const pairKey = node < neighbor ? `${node}:${neighbor}` : `${neighbor}:${node}`;
          const sim = pairSimilarities.get(pairKey) ?? 0;
          if (sim > maxSim) maxSim = sim;
        }
      }

      if (component.length >= 2) {
        const members = component.map((idx) => wordSets[idx].fact);
        for (const f of members) {
          if (f.uuid) claimed.add(f.uuid);
        }
        groups.push({
          reason: 'similar-content',
          facts: members,
          similarity: Math.round(maxSim * 100) / 100,
        });
      }
    }
  }

  // Sort by similarity descending, apply limit
  groups.sort((a, b) => b.similarity - a.similarity);
  return groups.slice(0, limit);
}

/**
 * Default options for deduplication.
 */
const DEDUP_DEFAULTS: Required<IDeduplicationOptions> = {
  minSimilarity: 0.6,
  limit: 10,
  since: new Date(0), // epoch — no filter
};

/**
 * Create a DeduplicationService.
 *
 * @param memoryService - Memory service with quality reader (for loading facts and conflicts)
 */
export function createDeduplicationService(
  memoryService: IMemoryServiceWithQuality
): IDeduplicationService {
  return {
    async detectDuplicates(
      groupId: string,
      options?: IDeduplicationOptions
    ): Promise<IDeduplicationResult> {
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

      const duplicateGroups = detectDuplicatesFromFacts(facts, conflictGroups, opts);

      return {
        totalFactsScanned: facts.length,
        duplicateGroups,
        totalDuplicates: duplicateGroups.length,
      };
    },
  };
}
