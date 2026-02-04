/**
 * Commit Extraction Prompt Builder.
 *
 * Constructs system and user prompts for LLM-based fact extraction
 * from git commits. Requests structured JSON output with typed facts,
 * confidence levels, and tags.
 *
 * Part of LISA-8: Phase 2 Git-Powered Memory Enrichment.
 */

import type { IScoredCommit } from '../../../domain/interfaces/IGitTriageService';
import type { ICommitEnrichmentOptions, CommitFactType } from '../../../domain/interfaces/ICommitEnricher';

/**
 * Built prompt pair for the commit extraction LLM call.
 */
export interface ICommitExtractionPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Default maximum facts to extract per batch.
 */
const DEFAULT_MAX_FACTS = 10;

/**
 * Build an extraction prompt from a batch of high-interest commits.
 *
 * @param commits - High-interest commits from triage
 * @param options - Enrichment options
 */
export function buildCommitExtractionPrompt(
  commits: readonly IScoredCommit[],
  options: ICommitEnrichmentOptions = {}
): ICommitExtractionPrompt {
  const extractTypes = options.extractTypes;
  const maxFacts = Math.min(commits.length * 2, DEFAULT_MAX_FACTS);

  const validTypes: readonly string[] = extractTypes && extractTypes.length > 0
    ? extractTypes
    : ([
        'feature',
        'decision',
        'refactor',
        'migration',
        'bugfix',
        'breaking-change',
        'convention',
        'dependency',
      ] satisfies readonly CommitFactType[]);

  const system = [
    'You are analyzing git commits to extract structured facts for project memory.',
    'Your task is to identify important information worth remembering long-term.',
    '',
    'Fact types to extract:',
    '- feature: New functionality or capability added to the project',
    '- decision: Architecture or technology choice evident from the commit',
    '- refactor: Code restructuring without behavior change',
    '- migration: Data migration, API migration, or technology migration',
    '- bugfix: Bug fix with root cause (what was broken and why)',
    '- breaking-change: Changes that break backward compatibility',
    '- convention: New patterns or coding conventions introduced',
    '- dependency: Significant dependency additions, updates, or removals',
    '',
    'Confidence levels:',
    '- high: Clear from commit message, subject, or explicit description',
    '- medium: Reasonably inferred from commit context and signals',
    '- low: Tentative inference, may need verification',
    '',
    'Guidelines:',
    '- Each fact should be self-contained and understandable without the commit context.',
    '- Include relevant file paths, technologies, or components in tags.',
    '- For bugfixes, try to identify the root cause if evident from the message.',
    '- Focus on facts that would be valuable for future developers.',
    '- Do not extract trivial changes (formatting, typos, version bumps).',
    `- Extract at most ${maxFacts} facts total across all commits.`,
    extractTypes && extractTypes.length > 0
      ? `- Only extract facts of these types: ${extractTypes.join(', ')}`
      : '- Extract facts of any type listed above.',
    '',
    'Respond with ONLY a valid JSON object in this exact format:',
    '{',
    '  "facts": [',
    '    {',
    '      "text": "Clear description of the fact",',
    `      "type": "one of: ${validTypes.join(', ')}",`,
    '      "confidence": "high | medium | low",',
    '      "tags": ["relevant", "tags"],',
    '      "commitSha": "short SHA of the source commit",',
    '      "rationale": "Why this fact is worth remembering"',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const user = formatCommitsForPrompt(commits);

  return { system, user };
}

/**
 * Format commits into a structured prompt section.
 */
function formatCommitsForPrompt(commits: readonly IScoredCommit[]): string {
  const parts: string[] = [];
  parts.push('## Commits to Analyze');
  parts.push('');

  for (let i = 0; i < commits.length; i++) {
    const { commit, stats, signals } = commits[i];
    parts.push(`### Commit ${i + 1}: ${commit.shortSha}`);
    parts.push(`**Subject:** ${commit.subject}`);

    if (commit.body && commit.body.trim().length > 0) {
      const truncatedBody = commit.body.length > 500
        ? commit.body.slice(0, 500) + '...'
        : commit.body;
      parts.push(`**Body:** ${truncatedBody}`);
    }

    parts.push(`**Timestamp:** ${commit.timestamp.toISOString()}`);
    parts.push(`**Author:** ${commit.author}`);

    if (stats) {
      parts.push(`**Files changed:** ${stats.filesChanged}`);
      parts.push(`**Lines:** +${stats.insertions} -${stats.deletions}`);

      if (stats.directoriesCreated.length > 0) {
        parts.push(`**New directories:** ${stats.directoriesCreated.join(', ')}`);
      }
    }

    // Format interest signals
    const signalList = formatSignals(signals);
    if (signalList.length > 0) {
      parts.push(`**Signals:** ${signalList.join(', ')}`);
    }

    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Format interest signals into readable strings.
 */
function formatSignals(signals: IScoredCommit['signals']): string[] {
  const result: string[] = [];

  if (signals.largeDiffFiles) {
    result.push('large-diff-files');
  }
  if (signals.largeDiffLines) {
    result.push('large-diff-lines');
  }
  if (signals.mergeCommitWithPR && signals.prNumber) {
    result.push(`merge-PR-#${signals.prNumber}`);
  }
  if (signals.hasConventionalPrefix && signals.conventionalType) {
    result.push(`conventional:${signals.conventionalType}`);
  }
  if (signals.hasDecisionKeywords) {
    result.push('decision-keywords');
  }
  if (signals.createsNewDirectory) {
    result.push('new-directory');
  }
  if (signals.isTagAdjacent) {
    result.push('tag-adjacent');
  }
  if (signals.hasLongMessageBody) {
    result.push('detailed-message');
  }

  return result;
}
