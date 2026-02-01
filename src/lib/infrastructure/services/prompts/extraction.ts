/**
 * Extraction Prompt Builder.
 *
 * Constructs system and user prompts for LLM-based fact extraction
 * from session transcripts. Requests structured JSON output with
 * typed facts, confidence levels, and tags.
 *
 * Part of Phase 6C: Enhanced Session Transcript Extraction.
 */

import type { IWorkSummary } from '../../../domain/interfaces/IWorkSummary';
import type { IEnrichmentOptions, ExtractedFactType } from '../../../domain/interfaces/ITranscriptEnricher';

/**
 * Built prompt pair for the extraction LLM call.
 */
export interface IExtractionPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Build an extraction prompt from a work summary and transcript snippet.
 *
 * @param workSummary - Parsed work summary from the session
 * @param transcript - Raw transcript text snippet
 * @param options - Enrichment options
 */
export function buildExtractionPrompt(
  workSummary: IWorkSummary,
  transcript: string,
  options: IEnrichmentOptions = {}
): IExtractionPrompt {
  const depth = options.depth ?? 'fast';
  const maxFacts = depth === 'fast' ? 5 : 15;
  const extractTypes = options.extractTypes;

  const validTypes: readonly string[] = extractTypes && extractTypes.length > 0
    ? extractTypes
    : (['decision', 'learning', 'blocker', 'task', 'preference', 'convention', 'gotcha'] satisfies readonly ExtractedFactType[]);

  const system = [
    'You are analyzing a coding session transcript to extract structured facts.',
    'Your task is to identify the most important information worth remembering.',
    '',
    'Fact types to extract:',
    '- decision: Architecture or technology choices made during the session',
    '- learning: New knowledge gained, insights, or discoveries',
    '- blocker: Problems encountered, blockers, or issues that slowed work',
    '- task: Action items or follow-up work identified',
    '- preference: User preferences or workflow habits expressed',
    '- convention: Naming patterns, code structure rules, or project conventions',
    '- gotcha: Bugs found, workarounds needed, or pitfalls to avoid',
    '',
    'Confidence levels:',
    '- high: Explicitly stated or clearly demonstrated in the transcript',
    '- medium: Reasonably inferred from context',
    '- low: Tentative inference, may need verification',
    '',
    'Guidelines:',
    '- Focus on facts that would be valuable in future sessions.',
    '- Each fact should be self-contained and understandable without the transcript.',
    '- Include relevant file paths, tool names, or technologies in tags.',
    '- Do not extract trivial or obvious information.',
    `- Extract at most ${maxFacts} facts, prioritizing the most important.`,
    extractTypes && extractTypes.length > 0
      ? `- Only extract facts of these types: ${extractTypes.join(', ')}`
      : '- Extract facts of any type listed above.',
    '',
    'Respond with ONLY a valid JSON object in this exact format:',
    '{',
    '  "facts": [',
    '    {',
    '      "text": "Clear, self-contained description of the fact",',
    `      "type": "one of: ${validTypes.join(', ')}",`,
    '      "confidence": "high | medium | low",',
    '      "tags": ["relevant", "tags"],',
    '      "rationale": "Why this fact is worth remembering"',
    '    }',
    '  ],',
    '  "summary": "A 1-2 sentence summary of the session\'s main accomplishment"',
    '}',
  ].join('\n');

  const contextParts: string[] = [];
  contextParts.push('## Session Context');
  contextParts.push('');
  contextParts.push(`- User prompts: ${workSummary.userPrompts}`);
  contextParts.push(`- Assistant responses: ${workSummary.assistantResponses}`);
  contextParts.push(`- Tool calls: ${workSummary.toolCalls}`);

  if (workSummary.filesCreated.length > 0) {
    contextParts.push(`- Files created: ${workSummary.filesCreated.join(', ')}`);
  }
  if (workSummary.filesModified.length > 0) {
    contextParts.push(`- Files modified: ${workSummary.filesModified.join(', ')}`);
  }
  if (workSummary.summary) {
    contextParts.push(`- Session summary: ${workSummary.summary.slice(0, 300)}`);
  }

  contextParts.push('');
  contextParts.push('## Transcript');
  contextParts.push('');
  contextParts.push(transcript);

  const user = contextParts.join('\n');

  return { system, user };
}
