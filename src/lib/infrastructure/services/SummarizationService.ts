/**
 * Summarization Service Implementation.
 *
 * Loads memory facts and produces LLM-generated summaries.
 * Uses the LlmGuard for policy enforcement (budget, feature toggles).
 *
 * Part of Phase 6B: AI-Powered Memory Summarization.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { IMemoryService, IMemoryDateOptions } from '../../domain/interfaces/IMemoryService';
import type {
  ISummarizationService,
  ISummarizationResult,
  ISummarizationOptions,
} from '../../domain/interfaces/ISummarizationService';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { IMemoryItem } from '../../domain/interfaces/types';
import { buildSummarizationPrompt } from './prompts/summarization';

/** Default maximum facts to send to LLM. */
const DEFAULT_MAX_FACTS = 50;

/**
 * Parse topics from LLM response text.
 * Looks for a line starting with "TOPICS:" followed by a JSON array.
 */
function parseTopics(text: string): readonly string[] {
  const match = text.match(/TOPICS:\s*(\[.*\])/s);
  if (!match?.[1]) return [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Extract the summary text (everything before the TOPICS: line).
 */
function extractSummaryText(text: string): string {
  const topicsIndex = text.indexOf('TOPICS:');
  if (topicsIndex === -1) return text.trim();
  return text.slice(0, topicsIndex).trim();
}

/**
 * Compute time range from facts.
 */
function computeTimeRange(facts: readonly IMemoryItem[]): { from: string; to: string } {
  const dates = facts
    .map(f => f.created_at)
    .filter((d): d is string => d !== undefined && d !== null)
    .sort();

  if (dates.length === 0) {
    const now = new Date().toISOString();
    return { from: now, to: now };
  }

  return { from: dates[0] as string, to: dates[dates.length - 1] as string };
}

/**
 * Create a summarization service.
 *
 * @param memoryService - Memory service for loading facts
 * @param llmGuard - LLM guard for policy-enforced completions
 * @param logger - Optional logger
 */
export function createSummarizationService(
  memoryService: IMemoryService,
  llmGuard: ILlmGuard,
  logger?: ILogger
): ISummarizationService {
  return {
    async summarize(
      groupId: string,
      options: ISummarizationOptions = {}
    ): Promise<ISummarizationResult> {
      const maxFacts = options.maxFacts ?? DEFAULT_MAX_FACTS;

      // Load facts — use search if topic is provided, otherwise date-ordered
      let facts: IMemoryItem[];

      if (options.topic) {
        facts = await memoryService.searchFacts([groupId], options.topic, maxFacts);
      } else {
        const dateOpts: IMemoryDateOptions = {};
        if (options.since) dateOpts.since = options.since;
        facts = await memoryService.loadFactsDateOrdered([groupId], maxFacts, dateOpts);
      }

      if (facts.length === 0) {
        return {
          summary: 'No facts found matching the specified criteria.',
          factCount: 0,
          timeRange: computeTimeRange([]),
          topics: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      }

      logger?.debug('Summarization: loaded facts', {
        groupId,
        factCount: facts.length,
        topic: options.topic,
        since: options.since?.toISOString(),
      });

      // Build prompt
      const prompt = buildSummarizationPrompt(facts, options);

      // Call LLM via guard
      const response = await llmGuard.complete(prompt.user, 'summarization', {
        systemPrompt: prompt.system,
        maxTokens: options.style === 'detailed' ? 2048 : 1024,
        temperature: 0.3,
      });

      // Parse response
      const summary = extractSummaryText(response.text);
      const topics = parseTopics(response.text);
      const timeRange = computeTimeRange(facts);

      logger?.debug('Summarization: complete', {
        groupId,
        factCount: facts.length,
        topicCount: topics.length,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });

      return {
        summary,
        factCount: facts.length,
        timeRange,
        topics,
        usage: response.usage,
      };
    },
  };
}
