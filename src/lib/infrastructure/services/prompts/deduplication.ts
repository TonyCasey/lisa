/**
 * Deduplication Prompt Builder.
 *
 * Constructs system and user prompts for LLM-based semantic
 * duplicate detection. Presents facts as a numbered list and
 * requests JSON grouping of semantically equivalent facts.
 *
 * Part of Phase 6D: Intelligent LLM-Assisted Deduplication.
 */

/**
 * Fact summary for the LLM prompt (minimal fields).
 */
export interface IFactSummary {
  readonly uuid: string;
  readonly text: string;
  readonly tags: readonly string[];
}

/**
 * Built prompt pair for the deduplication LLM call.
 */
export interface IDeduplicationPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Build a deduplication prompt from a batch of facts.
 *
 * @param facts - Facts to analyze for semantic duplicates
 */
export function buildDeduplicationPrompt(
  facts: readonly IFactSummary[]
): IDeduplicationPrompt {
  const system = [
    'You are analyzing a knowledge base for semantic duplicates.',
    'Facts that express the same information in different words are duplicates.',
    '',
    'Guidelines:',
    '- Group facts that convey the same core information, even if worded differently.',
    '- Do NOT group facts that are merely related — they must be truly redundant.',
    '- A fact should appear in at most one group.',
    '- For each group, suggest a single merged text that captures the information.',
    '- If no duplicates exist, return an empty groups array.',
    '',
    'Respond with ONLY a valid JSON object in this exact format:',
    '{',
    '  "groups": [',
    '    {',
    '      "uuids": ["uuid1", "uuid2"],',
    '      "reason": "Brief explanation of why these are duplicates",',
    '      "suggestedMerge": "A single sentence that captures the shared information"',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const formattedFacts = facts.map((f, i) => {
    const tagStr = f.tags.length > 0 ? ` (${f.tags.join(', ')})` : '';
    return `${i + 1}. [${f.uuid}] ${f.text}${tagStr}`;
  }).join('\n');

  const user = [
    'Analyze the following facts for semantic duplicates:',
    '',
    formattedFacts,
  ].join('\n');

  return { system, user };
}
