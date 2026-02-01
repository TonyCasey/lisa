/**
 * CompactionService
 *
 * Groups old facts by topic, creates template-based summary facts,
 * and archives (expires) the originals.
 * LLM-assisted summarization is deferred to Phase 6.
 */

import type {
  ICompactionService,
  ICompactionOptions,
  ICompactionResult,
  ICompactionSummary,
  IMemoryService,
  IMemoryItem,
} from '../../domain';

const DEFAULT_MIN_GROUP_SIZE = 3;
const MAX_FACTS_TO_LOAD = 500;
const MAX_SUMMARY_SNIPPETS = 3;
const SNIPPET_MAX_LENGTH = 50;

/**
 * A group of facts sharing a common topic/category.
 */
interface IFactGroup {
  readonly topic: string;
  readonly items: readonly IMemoryItem[];
}

/**
 * Extract a category from a memory item's name prefix or tags.
 */
function extractCategory(item: IMemoryItem): string {
  // Check name for PREFIX: pattern (e.g., "DECISION: ...", "MILESTONE: ...")
  if (item.name) {
    const prefixMatch = item.name.match(/^([A-Z_]+):\s/);
    if (prefixMatch) return prefixMatch[1].toLowerCase();
  }

  // Check tags for type:* tag (e.g., "type:decision", "type:milestone")
  if (item.tags) {
    for (const tag of item.tags) {
      if (tag.startsWith('type:') && tag !== 'type:compaction-summary') {
        return tag.slice(5);
      }
    }
  }

  return 'general';
}

export class CompactionService implements ICompactionService {
  constructor(
    private readonly memoryService: IMemoryService
  ) {}

  async compact(groupId: string, options: ICompactionOptions): Promise<ICompactionResult> {
    return this.runCompaction(groupId, options);
  }

  async preview(groupId: string, options: Omit<ICompactionOptions, 'dryRun'>): Promise<ICompactionResult> {
    return this.runCompaction(groupId, { ...options, dryRun: true });
  }

  private async runCompaction(groupId: string, options: ICompactionOptions): Promise<ICompactionResult> {
    const { olderThan, dryRun = false, minGroupSize = DEFAULT_MIN_GROUP_SIZE } = options;

    // Load old, non-expired facts
    const facts = await this.memoryService.loadFactsDateOrdered(
      [groupId], MAX_FACTS_TO_LOAD, { until: olderThan }
    );

    // Group by category
    const groups = this.groupByCategory(facts);

    // Filter groups smaller than threshold
    const qualifying = groups.filter(g => g.items.length >= minGroupSize);

    let factsArchived = 0;
    let summariesCreated = 0;
    const summaries: ICompactionSummary[] = [];

    for (const group of qualifying) {
      const summary = this.generateSummary(group);
      summaries.push(summary);

      if (!dryRun) {
        // Save summary fact with compaction tags
        const summaryTags = ['type:compaction-summary', `compacted:${group.topic}`];
        await this.memoryService.addFact(groupId, summary.summaryText, summaryTags);

        // Expire original facts
        for (const uuid of summary.archivedUuids) {
          await this.memoryService.expireFact(groupId, uuid);
        }
      }

      factsArchived += summary.archivedUuids.length;
      summariesCreated++;
    }

    return {
      groupsProcessed: qualifying.length,
      factsArchived,
      summariesCreated,
      summaries,
    };
  }

  /**
   * Group facts by their extracted category.
   */
  private groupByCategory(facts: readonly IMemoryItem[]): IFactGroup[] {
    const map = new Map<string, IMemoryItem[]>();

    for (const fact of facts) {
      const category = extractCategory(fact);
      const existing = map.get(category);
      if (existing) {
        existing.push(fact);
      } else {
        map.set(category, [fact]);
      }
    }

    return Array.from(map.entries()).map(([topic, items]) => ({ topic, items }));
  }

  /**
   * Generate a template-based summary for a group of facts.
   */
  private generateSummary(group: IFactGroup): ICompactionSummary {
    const { topic, items } = group;

    // Sort by date ascending for range display
    const sorted = [...items].sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ad - bd;
    });

    const firstDate = sorted[0]?.created_at;
    const lastDate = sorted[sorted.length - 1]?.created_at;
    const earliest = firstDate
      ? new Date(firstDate).toISOString().split('T')[0]
      : 'unknown';
    const latest = lastDate
      ? new Date(lastDate).toISOString().split('T')[0]
      : 'unknown';

    // Build snippet list from first few facts
    const snippets = sorted.slice(0, MAX_SUMMARY_SNIPPETS).map(f => {
      const text = f.fact || f.name || '';
      return text.length > SNIPPET_MAX_LENGTH ? text.slice(0, SNIPPET_MAX_LENGTH - 3) + '...' : text;
    });
    const snippetText = snippets.join('; ');

    const topicLabel = topic.charAt(0).toUpperCase() + topic.slice(1);
    const summaryText = `[Compacted] ${topicLabel}: ${items.length} items from ${earliest} to ${latest}: ${snippetText}`;

    const archivedUuids = items
      .map(f => f.uuid)
      .filter((u): u is string => u !== undefined);

    return {
      topic,
      factCount: items.length,
      summaryText,
      archivedUuids,
    };
  }
}
