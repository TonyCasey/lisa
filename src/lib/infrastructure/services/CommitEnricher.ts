/**
 * Commit Enricher Implementation.
 *
 * LLM-powered extraction of structured facts from git commits.
 * Takes high-interest commits from GitTriageService and extracts
 * meaningful facts (features, decisions, refactors, etc.) for memory.
 *
 * Error Handling:
 * - Graceful fallback: if the LLM call fails for any reason, returns
 *   an empty result — never blocks session start or git triage.
 * - Error messages are sanitized (first line only) to avoid logging
 *   raw API response bodies which may contain sensitive data.
 *
 * Part of LISA-8: Phase 2 Git-Powered Memory Enrichment.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ILlmUsage } from '../../domain/interfaces/ILlmService';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { IScoredCommit } from '../../domain/interfaces/IGitTriageService';
import type {
  ICommitEnricher,
  ICommitEnrichmentResult,
  ICommitEnrichmentOptions,
  ICommitFact,
  CommitFactType,
} from '../../domain/interfaces/ICommitEnricher';
import { isValidCommitFactType } from '../../domain/interfaces/ICommitEnricher';
import { isValidConfidence } from '../../domain/interfaces/types/IMemoryQuality';
import type { ConfidenceLevel } from '../../domain/interfaces/types/IMemoryQuality';
import { buildCommitExtractionPrompt } from './prompts/commit-extraction';

/** Default maximum commits to process in one batch. */
const DEFAULT_MAX_COMMITS = 5;

/** Default maximum tokens for the LLM call. */
const DEFAULT_MAX_TOKENS = 4096;

/** Empty usage stats for fallback results. */
const EMPTY_USAGE: ILlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Create a commit enricher.
 *
 * @param llmGuard - LLM guard for policy-enforced completions
 * @param logger - Optional logger
 */
export function createCommitEnricher(
  llmGuard: ILlmGuard,
  logger?: ILogger
): ICommitEnricher {
  return {
    async enrich(
      commits: readonly IScoredCommit[],
      options: ICommitEnrichmentOptions = {}
    ): Promise<ICommitEnrichmentResult> {
      try {
        // Filter out commits that should be skipped
        const skipShas = new Set(options.skipShas ?? []);
        const filteredCommits = commits.filter(c => !skipShas.has(c.commit.sha));

        if (filteredCommits.length === 0) {
          return {
            facts: [],
            commitsProcessed: 0,
            commitsSkipped: commits.length,
            usage: EMPTY_USAGE,
          };
        }

        // Limit to maxCommits
        const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
        const toProcess = filteredCommits.slice(0, maxCommits);
        const skipped = commits.length - toProcess.length;

        const prompt = buildCommitExtractionPrompt(toProcess, options);

        const response = await llmGuard.complete(prompt.user, 'extraction', {
          systemPrompt: prompt.system,
          temperature: 0.3,
          maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        });

        const parsed = parseCommitExtractionResponse(response.text, options);

        return {
          facts: parsed.facts,
          commitsProcessed: toProcess.length,
          commitsSkipped: skipped,
          usage: response.usage,
        };
      } catch (error) {
        // Sanitize error message to avoid logging raw API response bodies
        const errorMsg = error instanceof Error
          ? error.message.split('\n')[0]  // Take only first line
          : 'Unknown error';
        logger?.warn('Commit enrichment failed, returning empty result', {
          error: errorMsg,
        });
        return {
          facts: [],
          commitsProcessed: 0,
          commitsSkipped: commits.length,
          usage: EMPTY_USAGE,
        };
      }
    },
  };
}

/**
 * Parse and validate the LLM extraction response.
 *
 * Expects JSON with `{ facts: [...] }`.
 * Invalid facts are silently dropped.
 */
function parseCommitExtractionResponse(
  responseText: string,
  options: ICommitEnrichmentOptions = {}
): { facts: ICommitFact[] } {
  // Try to extract JSON from the response
  const jsonText = extractJson(responseText);
  if (!jsonText) {
    return { facts: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { facts: [] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { facts: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];

  const allowedTypes = options.extractTypes;
  const facts: ICommitFact[] = [];

  for (const raw of rawFacts) {
    const fact = validateCommitFact(raw, allowedTypes);
    if (fact) {
      facts.push(fact);
    }
  }

  return { facts };
}

/**
 * Extract JSON from LLM response text.
 * Handles responses that may have text before/after the JSON block.
 * Uses progressive try-parse from each '{' to handle braces inside strings.
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // Try each '{' as a potential JSON start
  let start = trimmed.indexOf('{');
  while (start !== -1) {
    // Try parsing progressively longer substrings from this start
    for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
      const candidate = trimmed.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Try a shorter substring
      }
    }
    start = trimmed.indexOf('{', start + 1);
  }

  return null;
}

/**
 * Validate a single extracted commit fact from the LLM response.
 * Returns null for invalid facts.
 */
function validateCommitFact(
  raw: unknown,
  allowedTypes?: readonly CommitFactType[]
): ICommitFact | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Text is required and must be non-empty
  if (typeof obj.text !== 'string' || obj.text.trim().length === 0) return null;

  // Type must be valid
  if (typeof obj.type !== 'string' || !isValidCommitFactType(obj.type)) return null;

  // If type filter specified, enforce it
  if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(obj.type as CommitFactType)) {
    return null;
  }

  // commitSha is required
  if (typeof obj.commitSha !== 'string' || obj.commitSha.trim().length === 0) return null;

  // Confidence must be valid (default to 'medium' if missing)
  let confidence: ConfidenceLevel = 'medium';
  if (typeof obj.confidence === 'string') {
    if (isValidConfidence(obj.confidence)) {
      confidence = obj.confidence;
    }
    // If invalid confidence string, keep default 'medium'
  }

  // Tags must be string array (default to empty)
  const tags: string[] = [];
  if (Array.isArray(obj.tags)) {
    for (const tag of obj.tags) {
      if (typeof tag === 'string' && tag.trim().length > 0) {
        tags.push(tag.trim());
      }
    }
  }

  // Rationale is optional
  const rationale = typeof obj.rationale === 'string' && obj.rationale.trim().length > 0
    ? obj.rationale.trim()
    : undefined;

  return {
    text: obj.text.trim(),
    type: obj.type as CommitFactType,
    confidence,
    tags,
    commitSha: obj.commitSha.trim(),
    rationale,
  };
}
