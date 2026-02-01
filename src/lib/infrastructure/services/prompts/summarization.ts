/**
 * Summarization Prompt Builder.
 *
 * Constructs system and user prompts for LLM-based memory summarization.
 * Formats facts with dates, types, and tags for optimal extraction.
 *
 * Part of Phase 6B: AI-Powered Memory Summarization.
 */

import type { IMemoryItem } from '../../../domain/interfaces/types';
import type { ISummarizationOptions } from '../../../domain/interfaces/ISummarizationService';

/**
 * Built prompt pair for the summarization LLM call.
 */
export interface ISummarizationPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Build a summarization prompt from memory facts.
 *
 * @param facts - Memory facts to summarize
 * @param options - Summarization options (style, topic)
 */
export function buildSummarizationPrompt(
  facts: readonly IMemoryItem[],
  options: ISummarizationOptions = {}
): ISummarizationPrompt {
  const style = options.style ?? 'concise';
  const topic = options.topic;

  const system = [
    'You are a knowledge base curator analyzing a software project\'s accumulated memories.',
    'Your task is to produce a clear, structured summary of the facts provided.',
    '',
    'Guidelines:',
    '- Focus on key decisions, patterns, conventions, and lessons learned.',
    '- Group related information together.',
    '- Note any contradictions or superseded decisions.',
    '- List the main topics covered at the end as a JSON array.',
    '',
    'Output format:',
    style === 'concise'
      ? 'Produce a summary in 2-3 concise paragraphs, then a topics list.'
      : 'Produce a detailed summary in 4-6 paragraphs covering all significant details, then a topics list.',
    '',
    'End your response with exactly this format:',
    'TOPICS: ["topic1", "topic2", ...]',
  ].join('\n');

  const formattedFacts = facts.map((f, i) => {
    const parts: string[] = [`${i + 1}.`];
    if (f.created_at) parts.push(`[${f.created_at}]`);
    if (f.tags && f.tags.length > 0) parts.push(`(${f.tags.join(', ')})`);
    parts.push(f.fact ?? f.name ?? '(no text)');
    return parts.join(' ');
  }).join('\n');

  const userParts: string[] = [];

  if (topic) {
    userParts.push(`Summarize the following project memories related to "${topic}":`);
  } else {
    userParts.push('Summarize the following project memories:');
  }

  userParts.push('');
  userParts.push(formattedFacts);

  const user = userParts.join('\n');

  return { system, user };
}
