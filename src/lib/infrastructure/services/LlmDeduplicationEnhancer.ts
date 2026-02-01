/**
 * LLM Deduplication Enhancer.
 *
 * Provides a 4th-pass semantic deduplication via LLM analysis.
 * Receives unclaimed facts (not already grouped by the 3-pass algorithm)
 * and asks the LLM to identify semantically equivalent facts.
 *
 * Results are returned as IDuplicateGroup with reason 'llm-semantic'.
 * Graceful fallback: returns empty groups on any LLM failure.
 *
 * Part of Phase 6D: Intelligent LLM-Assisted Deduplication.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { IMemoryItem } from '../../domain/interfaces/types';
import type { IDuplicateGroup } from '../../domain/interfaces/IDeduplicationService';
import { buildDeduplicationPrompt } from './prompts/deduplication';

/**
 * Options for the LLM deduplication enhancer.
 */
export interface ILlmDeduplicationOptions {
  /** Maximum facts to send to the LLM (default: 100) */
  readonly maxFacts?: number;
  /** Batch size for LLM calls (default: 20) */
  readonly batchSize?: number;
}

/**
 * LLM-assisted semantic deduplication enhancer interface.
 */
export interface ILlmDeduplicationEnhancer {
  /**
   * Find semantic duplicates among unclaimed facts using LLM analysis.
   *
   * @param facts - All facts from the group
   * @param existingGroups - Groups already found by the 3-pass algorithm
   * @param options - Batch size and limit options
   * @returns New duplicate groups with reason 'llm-semantic'
   */
  findSemanticDuplicates(
    facts: readonly IMemoryItem[],
    existingGroups: readonly IDuplicateGroup[],
    options?: ILlmDeduplicationOptions
  ): Promise<readonly IDuplicateGroup[]>;
}

/** Default batch size for LLM deduplication. */
const DEFAULT_BATCH_SIZE = 20;

/** Default maximum facts to process. */
const DEFAULT_MAX_FACTS = 100;

/**
 * Create an LLM deduplication enhancer.
 *
 * @param llmGuard - LLM guard for policy-enforced completions
 * @param logger - Optional logger
 */
export function createLlmDeduplicationEnhancer(
  llmGuard: ILlmGuard,
  logger?: ILogger
): ILlmDeduplicationEnhancer {
  return {
    async findSemanticDuplicates(
      facts: readonly IMemoryItem[],
      existingGroups: readonly IDuplicateGroup[],
      options?: ILlmDeduplicationOptions
    ): Promise<readonly IDuplicateGroup[]> {
      try {
        const maxFacts = options?.maxFacts ?? DEFAULT_MAX_FACTS;
        const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

        // Collect UUIDs already claimed by existing groups
        const claimed = new Set<string>();
        for (const group of existingGroups) {
          for (const f of group.facts) {
            if (f.uuid) claimed.add(f.uuid);
          }
        }

        // Filter to unclaimed facts with uuid and text
        const unclaimed = facts.filter(
          f => f.uuid && f.fact && !claimed.has(f.uuid)
        ).slice(0, maxFacts);

        if (unclaimed.length < 2) {
          return [];
        }

        // Build a uuid→fact lookup for quick resolution
        const factLookup = new Map<string, IMemoryItem>();
        for (const f of unclaimed) {
          if (f.uuid) factLookup.set(f.uuid, f);
        }

        // Process in batches
        const allGroups: IDuplicateGroup[] = [];
        const globalClaimed = new Set<string>();

        for (let i = 0; i < unclaimed.length; i += batchSize) {
          const batch = unclaimed.slice(i, i + batchSize);
          if (batch.length < 2) break;

          const batchGroups = await processBatch(batch, factLookup, globalClaimed, llmGuard, logger);
          for (const group of batchGroups) {
            allGroups.push(group);
          }
        }

        return allGroups;
      } catch (error) {
        logger?.warn('LLM deduplication enhancer failed, returning empty groups', {
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },
  };
}

/**
 * Process a single batch of facts through the LLM.
 */
async function processBatch(
  batch: readonly IMemoryItem[],
  factLookup: Map<string, IMemoryItem>,
  globalClaimed: Set<string>,
  llmGuard: ILlmGuard,
  logger?: ILogger
): Promise<IDuplicateGroup[]> {
  const factSummaries = batch
    .filter(f => f.uuid && !globalClaimed.has(f.uuid))
    .map(f => ({
      uuid: f.uuid!,
      text: f.fact ?? '',
      tags: f.tags ?? [],
    }));

  if (factSummaries.length < 2) return [];

  const prompt = buildDeduplicationPrompt(factSummaries);

  const response = await llmGuard.complete(prompt.user, 'deduplication', {
    systemPrompt: prompt.system,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return parseLlmResponse(response.text, factLookup, globalClaimed, logger);
}

/**
 * Parse the LLM response into duplicate groups.
 */
function parseLlmResponse(
  responseText: string,
  factLookup: Map<string, IMemoryItem>,
  globalClaimed: Set<string>,
  logger?: ILogger
): IDuplicateGroup[] {
  const jsonText = extractJson(responseText);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger?.debug('Failed to parse LLM deduplication response as JSON');
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const obj = parsed as Record<string, unknown>;
  const rawGroups = Array.isArray(obj.groups) ? obj.groups : [];

  const groups: IDuplicateGroup[] = [];

  for (const raw of rawGroups) {
    if (typeof raw !== 'object' || raw === null) continue;
    const groupObj = raw as Record<string, unknown>;

    // Extract uuids
    const uuids = Array.isArray(groupObj.uuids)
      ? (groupObj.uuids as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];

    if (uuids.length < 2) continue;

    // Resolve facts and skip already-claimed UUIDs
    const resolvedFacts: IMemoryItem[] = [];
    for (const uuid of uuids) {
      if (globalClaimed.has(uuid)) continue;
      const fact = factLookup.get(uuid);
      if (fact) resolvedFacts.push(fact);
    }

    if (resolvedFacts.length < 2) continue;

    // Mark as claimed
    for (const f of resolvedFacts) {
      if (f.uuid) globalClaimed.add(f.uuid);
    }

    const suggestedMerge = typeof groupObj.suggestedMerge === 'string' && groupObj.suggestedMerge.trim().length > 0
      ? groupObj.suggestedMerge.trim()
      : undefined;

    groups.push({
      reason: 'llm-semantic',
      facts: resolvedFacts,
      similarity: 0.8,
      suggestedMerge,
    });
  }

  return groups;
}

/**
 * Extract JSON from LLM response text.
 * Uses progressive try-parse from each '{' position.
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  let start = trimmed.indexOf('{');
  while (start !== -1) {
    for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
      const candidate = trimmed.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Try shorter substring
      }
    }
    start = trimmed.indexOf('{', start + 1);
  }

  return null;
}
