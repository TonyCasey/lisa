/**
 * Natural Language Curation Service.
 *
 * Translates natural language memory management commands into
 * structured operations via LLM intent classification.
 * Supports plan-then-execute workflow with confirmation for
 * destructive actions.
 *
 * Part of Phase 6E: Natural Language Curation.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { IMemoryService } from '../../domain/interfaces/IMemoryService';
import type { ICurationService, CurationMark } from '../../domain/interfaces/ICurationService';
import { isValidCurationMark } from '../../domain/interfaces/ICurationService';
import type { IConsolidationService } from '../../domain/interfaces/IConsolidationService';
import type { ISummarizationService } from '../../domain/interfaces/ISummarizationService';
import type {
  INlCurationService,
  INlCurationPlan,
  INlCurationResult,
  INlOperation,
  NlCurationIntent,
} from '../../domain/interfaces/INlCurationService';
import { isValidNlCurationIntent } from '../../domain/interfaces/INlCurationService';
import { buildCurationPrompt } from './prompts/curation';

/**
 * Create a Natural Language Curation Service.
 *
 * @param llmGuard - LLM guard for policy-enforced completions
 * @param memoryService - Memory service for search and expire operations
 * @param curationService - Curation service for mark operations
 * @param consolidationService - Consolidation service for merge operations
 * @param summarizationService - Summarization service for summary operations
 * @param logger - Optional logger
 */
export function createNlCurationService(
  llmGuard: ILlmGuard,
  memoryService: IMemoryService,
  curationService: ICurationService,
  consolidationService: IConsolidationService,
  summarizationService: ISummarizationService,
  logger?: ILogger
): INlCurationService {
  return {
    async plan(input: string, _groupId: string): Promise<INlCurationPlan> {
      const prompt = buildCurationPrompt(input);

      const response = await llmGuard.complete(prompt.user, 'curation', {
        systemPrompt: prompt.system,
        temperature: 0.2,
        maxTokens: 1024,
      });

      const parsed = parsePlanResponse(response.text, logger);

      return {
        intent: parsed.intent,
        description: parsed.description,
        isDestructive: parsed.isDestructive,
        operations: parsed.operations,
        usage: response.usage,
      };
    },

    async execute(plan: INlCurationPlan, groupId: string): Promise<INlCurationResult> {
      const outputParts: string[] = [];

      for (const operation of plan.operations) {
        try {
          const result = await executeOperation(
            operation,
            groupId,
            memoryService,
            curationService,
            consolidationService,
            summarizationService,
            logger
          );
          outputParts.push(result);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger?.warn('NL curation operation failed', {
            type: operation.type,
            error: msg,
          });
          outputParts.push(`Failed: ${operation.description} — ${msg}`);
        }
      }

      return {
        plan,
        executed: true,
        output: outputParts.join('\n\n'),
        usage: plan.usage,
      };
    },
  };
}

/**
 * Parse the LLM plan response into a structured plan.
 */
function parsePlanResponse(
  responseText: string,
  logger?: ILogger
): {
  intent: NlCurationIntent;
  description: string;
  isDestructive: boolean;
  operations: readonly INlOperation[];
} {
  const jsonText = extractJson(responseText);
  if (!jsonText) {
    logger?.debug('Failed to extract JSON from NL curation response');
    return fallbackPlan();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger?.debug('Failed to parse NL curation response as JSON');
    return fallbackPlan();
  }

  if (typeof parsed !== 'object' || parsed === null) return fallbackPlan();

  const obj = parsed as Record<string, unknown>;

  // Validate intent
  const rawIntent = typeof obj.intent === 'string' ? obj.intent : '';
  const intent: NlCurationIntent = isValidNlCurationIntent(rawIntent) ? rawIntent : 'query';

  // Extract description
  const description = typeof obj.description === 'string' && obj.description.trim().length > 0
    ? obj.description.trim()
    : 'Execute memory operation';

  // Extract isDestructive
  const isDestructive = typeof obj.isDestructive === 'boolean'
    ? obj.isDestructive
    : intent === 'expire' || intent === 'consolidate';

  // Extract operations
  const rawOps = Array.isArray(obj.operations) ? obj.operations : [];
  const operations: INlOperation[] = [];

  for (const raw of rawOps) {
    if (typeof raw !== 'object' || raw === null) continue;
    const opObj = raw as Record<string, unknown>;

    const type = typeof opObj.type === 'string' ? opObj.type : '';
    if (!['search', 'mark', 'expire', 'summarize', 'consolidate'].includes(type)) continue;

    const params = typeof opObj.params === 'object' && opObj.params !== null
      ? opObj.params as Readonly<Record<string, unknown>>
      : {};

    const opDesc = typeof opObj.description === 'string'
      ? opObj.description
      : `Perform ${type} operation`;

    operations.push({
      type: type as INlOperation['type'],
      params,
      description: opDesc,
    });
  }

  // Ensure at least one operation
  if (operations.length === 0) {
    operations.push({
      type: 'search',
      params: { query: description, limit: 10 },
      description: `Search for relevant facts`,
    });
  }

  return { intent, description, isDestructive, operations };
}

/**
 * Fallback plan when LLM response is unparseable.
 */
function fallbackPlan(): {
  intent: NlCurationIntent;
  description: string;
  isDestructive: boolean;
  operations: readonly INlOperation[];
} {
  return {
    intent: 'query',
    description: 'Search for relevant memories',
    isDestructive: false,
    operations: [{
      type: 'search',
      params: { query: '', limit: 10 },
      description: 'Search for recent facts',
    }],
  };
}

/**
 * Execute a single operation within a curation plan.
 */
async function executeOperation(
  operation: INlOperation,
  groupId: string,
  memoryService: IMemoryService,
  curationService: ICurationService,
  consolidationService: IConsolidationService,
  summarizationService: ISummarizationService,
  logger?: ILogger
): Promise<string> {
  switch (operation.type) {
    case 'search': {
      const query = typeof operation.params.query === 'string'
        ? operation.params.query
        : '';
      const limit = typeof operation.params.limit === 'number'
        ? operation.params.limit
        : 10;

      const facts = await memoryService.searchFacts([groupId], query, limit);

      if (facts.length === 0) {
        return `No facts found matching "${query}".`;
      }

      const lines = facts.map((f, i) =>
        `${i + 1}. [${f.uuid ?? 'no-uuid'}] ${f.fact ?? '(no text)'}`
      );
      return `Found ${facts.length} fact(s):\n${lines.join('\n')}`;
    }

    case 'mark': {
      const query = typeof operation.params.query === 'string'
        ? operation.params.query
        : '';
      const mark = typeof operation.params.mark === 'string'
        ? operation.params.mark
        : '';

      if (!isValidCurationMark(mark)) {
        return `Invalid curation mark: "${mark}". Valid marks: authoritative, draft, deprecated, needs-review.`;
      }

      const facts = await memoryService.searchFacts([groupId], query, 5);

      if (facts.length === 0) {
        return `No facts found matching "${query}" to mark as ${mark}.`;
      }

      let marked = 0;
      for (const fact of facts) {
        if (!fact.uuid) continue;
        try {
          await curationService.markFact(groupId, fact.uuid, mark as CurationMark);
          marked++;
        } catch (error) {
          logger?.debug('Failed to mark fact', {
            uuid: fact.uuid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return `Marked ${marked} fact(s) as ${mark}.`;
    }

    case 'expire': {
      const query = typeof operation.params.query === 'string'
        ? operation.params.query
        : '';

      const facts = await memoryService.searchFacts([groupId], query, 20);

      if (facts.length === 0) {
        return `No facts found matching "${query}" to expire.`;
      }

      let expired = 0;
      for (const fact of facts) {
        if (!fact.uuid) continue;
        try {
          await memoryService.expireFact(groupId, fact.uuid);
          expired++;
        } catch (error) {
          logger?.debug('Failed to expire fact', {
            uuid: fact.uuid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return `Expired ${expired} fact(s) matching "${query}".`;
    }

    case 'summarize': {
      const topic = typeof operation.params.topic === 'string'
        ? operation.params.topic
        : undefined;
      const style = operation.params.style === 'detailed' ? 'detailed' : 'concise';

      const result = await summarizationService.summarize(groupId, {
        topic,
        style,
      });

      return result.summary;
    }

    case 'consolidate': {
      const query = typeof operation.params.query === 'string'
        ? operation.params.query
        : '';

      const facts = await memoryService.searchFacts([groupId], query, 10);
      const uuids = facts.filter(f => f.uuid).map(f => f.uuid!);

      if (uuids.length < 2) {
        return `Not enough facts found matching "${query}" to consolidate (need at least 2).`;
      }

      const result = await consolidationService.consolidate(
        groupId,
        uuids,
        'archive-duplicates'
      );

      return `Consolidated ${uuids.length} facts: retained ${result.retainedUuid}, archived ${result.archivedUuids.length}.`;
    }

    default:
      return `Unknown operation type: ${operation.type}`;
  }
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
