/**
 * Transcript Enricher Implementation.
 *
 * LLM-powered extraction of structured facts from session transcripts.
 * Sends a truncated transcript snippet to the LLM and parses the
 * JSON response into validated IExtractedFact objects.
 *
 * Error Handling:
 * - Graceful fallback: if the LLM call fails for any reason, returns
 *   an empty result — never blocks session capture.
 * - Error messages are sanitized (first line only) to avoid logging
 *   raw API response bodies which may contain sensitive data.
 *
 * Part of Phase 6C: Enhanced Session Transcript Extraction.
 */

import type { ILlmGuard } from '../../domain/interfaces/ILlmGuard';
import type { ILlmUsage } from '../../domain/interfaces/ILlmService';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type {
  ITranscriptEnricher,
  IEnrichmentResult,
  IEnrichmentOptions,
  IExtractedFact,
  ExtractedFactType,
} from '../../domain/interfaces/ITranscriptEnricher';
import { isValidExtractedFactType } from '../../domain/interfaces/ITranscriptEnricher';
import { isValidConfidence } from '../../domain/interfaces/types/IMemoryQuality';
import type { ConfidenceLevel } from '../../domain/interfaces/types/IMemoryQuality';
import type { IWorkSummary } from '../../domain/interfaces/IWorkSummary';
import { buildExtractionPrompt } from './prompts/extraction';

/** Default maximum transcript snippet length in characters. */
const DEFAULT_MAX_SNIPPET_LENGTH = 4000;

/** Empty usage stats for fallback results. */
const EMPTY_USAGE: ILlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Create a transcript enricher.
 *
 * @param llmGuard - LLM guard for policy-enforced completions
 * @param logger - Optional logger
 */
export function createTranscriptEnricher(
  llmGuard: ILlmGuard,
  logger?: ILogger
): ITranscriptEnricher {
  return {
    async enrich(
      workSummary: IWorkSummary,
      transcriptSnippet: string,
      options: IEnrichmentOptions = {}
    ): Promise<IEnrichmentResult> {
      try {
        const maxLen = options.maxSnippetLength ?? DEFAULT_MAX_SNIPPET_LENGTH;
        const truncated = transcriptSnippet.length > maxLen
          ? transcriptSnippet.slice(0, maxLen)
          : transcriptSnippet;

        const prompt = buildExtractionPrompt(workSummary, truncated, options);

        const response = await llmGuard.complete(prompt.user, 'extraction', {
          systemPrompt: prompt.system,
          temperature: 0.3,
          maxTokens: options.depth === 'thorough' ? 4096 : 2048,
        });

        const parsed = parseExtractionResponse(response.text, options);

        return {
          facts: parsed.facts,
          summary: parsed.summary,
          usage: response.usage,
        };
      } catch (error) {
        // Sanitize error message to avoid logging raw API response bodies
        const errorMsg = error instanceof Error
          ? error.message.split('\n')[0]  // Take only first line
          : 'Unknown error';
        logger?.warn('Transcript enrichment failed, returning empty result', {
          error: errorMsg,
        });
        return {
          facts: [],
          summary: '',
          usage: EMPTY_USAGE,
        };
      }
    },
  };
}

/**
 * Parse and validate the LLM extraction response.
 *
 * Expects JSON with `{ facts: [...], summary: "..." }`.
 * Invalid facts are silently dropped.
 */
function parseExtractionResponse(
  responseText: string,
  options: IEnrichmentOptions = {}
): { facts: IExtractedFact[]; summary: string } {
  // Try to extract JSON from the response
  const jsonText = extractJson(responseText);
  if (!jsonText) {
    return { facts: [], summary: '' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { facts: [], summary: '' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { facts: [], summary: '' };
  }

  const obj = parsed as Record<string, unknown>;
  const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];
  const summary = typeof obj.summary === 'string' ? obj.summary : '';

  const allowedTypes = options.extractTypes;
  const facts: IExtractedFact[] = [];

  for (const raw of rawFacts) {
    const fact = validateFact(raw, allowedTypes);
    if (fact) {
      facts.push(fact);
    }
  }

  return { facts, summary };
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
 * Validate a single extracted fact from the LLM response.
 * Returns null for invalid facts.
 */
function validateFact(
  raw: unknown,
  allowedTypes?: readonly ExtractedFactType[]
): IExtractedFact | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Text is required and must be non-empty
  if (typeof obj.text !== 'string' || obj.text.trim().length === 0) return null;

  // Type must be valid
  if (typeof obj.type !== 'string' || !isValidExtractedFactType(obj.type)) return null;

  // If type filter specified, enforce it
  if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(obj.type as ExtractedFactType)) {
    return null;
  }

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
    type: obj.type as ExtractedFactType,
    confidence,
    tags,
    rationale,
  };
}
