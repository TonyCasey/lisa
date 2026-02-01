/**
 * Curation Prompt Builder.
 *
 * Constructs system and user prompts for LLM-based intent
 * classification of natural language memory curation commands.
 *
 * Part of Phase 6E: Natural Language Curation.
 */

/**
 * Built prompt pair for the curation LLM call.
 */
export interface ICurationPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Build an intent classification prompt from natural language input.
 *
 * @param input - The user's natural language command
 */
export function buildCurationPrompt(input: string): ICurationPrompt {
  const system = [
    'You are a memory curation assistant for a software project knowledge base.',
    'Your job is to classify the user\'s intent and plan operations.',
    '',
    'Available intents:',
    '- query: Search or ask about existing memories',
    '- mark: Change the curation status of a fact (authoritative, draft, deprecated, needs-review)',
    '- expire: Remove or forget facts',
    '- summarize: Summarize a set of memories',
    '- consolidate: Merge duplicate or related facts',
    '',
    'Available operations:',
    '- search: { query: string, limit?: number }',
    '- mark: { query: string, mark: "authoritative" | "draft" | "deprecated" | "needs-review" }',
    '- expire: { query: string }',
    '- summarize: { topic?: string, style?: "concise" | "detailed" }',
    '- consolidate: { query: string }',
    '',
    'Rules:',
    '- For "mark" and "expire" intents, always include a "search" operation first to find target facts.',
    '- Set isDestructive to true for "expire" and "consolidate" intents.',
    '- The description should be a clear, human-readable summary of what will happen.',
    '- Each operation description should explain what that step does.',
    '',
    'Examples:',
    '',
    'Input: "what do we know about authentication?"',
    'Response: { "intent": "query", "description": "Search for memories about authentication", "isDestructive": false, "operations": [{ "type": "search", "params": { "query": "authentication", "limit": 10 }, "description": "Search for facts related to authentication" }] }',
    '',
    'Input: "forget everything about the old API design"',
    'Response: { "intent": "expire", "description": "Expire all facts about the old API design", "isDestructive": true, "operations": [{ "type": "search", "params": { "query": "old API design" }, "description": "Find facts about the old API design" }, { "type": "expire", "params": { "query": "old API design" }, "description": "Expire the matching facts" }] }',
    '',
    'Input: "mark the PostgreSQL decision as authoritative"',
    'Response: { "intent": "mark", "description": "Mark the PostgreSQL decision as authoritative", "isDestructive": false, "operations": [{ "type": "search", "params": { "query": "PostgreSQL decision" }, "description": "Find the PostgreSQL decision fact" }, { "type": "mark", "params": { "query": "PostgreSQL decision", "mark": "authoritative" }, "description": "Mark the fact as authoritative" }] }',
    '',
    'Input: "summarize what happened this week"',
    'Response: { "intent": "summarize", "description": "Summarize memories from this week", "isDestructive": false, "operations": [{ "type": "summarize", "params": { "style": "concise" }, "description": "Generate a concise summary of recent memories" }] }',
    '',
    'Respond with ONLY a valid JSON object in this exact format:',
    '{',
    '  "intent": "<intent>",',
    '  "description": "<human-readable description>",',
    '  "isDestructive": <boolean>,',
    '  "operations": [',
    '    {',
    '      "type": "<operation type>",',
    '      "params": { ... },',
    '      "description": "<step description>"',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const user = `Classify the following memory curation command and plan operations:\n\n"${input}"`;

  return { system, user };
}
