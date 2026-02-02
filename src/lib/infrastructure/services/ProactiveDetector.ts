/**
 * ProactiveDetector
 *
 * Detects save-worthy events during conversation and returns
 * non-blocking save suggestions. Looks for:
 * - Decision confirmations (user confirms after assistant presents options)
 * - Milestones (PR creation, test success, completion, version bump)
 */

import type { IProactiveDetector, IProactiveDetection } from '../../domain/interfaces';

/**
 * User confirmation patterns that suggest a decision was made.
 */
const CONFIRMATION_PATTERN = /^(yes|ok|sounds good|let'?s go with|do that|go ahead|approved?|agreed?)\b/i;

/**
 * Assistant message patterns that suggest options were being presented.
 */
const OPTION_PRESENTING_PATTERN = /\b(option|approach|alternative|should we|we could|either|or|recommend|suggest)\b/i;

/**
 * Milestone patterns with named capture groups for context extraction.
 */
const MILESTONE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:created|opened)\s+(?:a\s+)?(?:PR|pull request)\s*#?\d*/i, label: 'PR creation' },
  { pattern: /\b(?:PR|pull request)\s*#\d+\b/i, label: 'PR creation' },
  { pattern: /\b(?:all\s+)?tests?\s+pass(?:ing|ed)?\b/i, label: 'Tests passing' },
  { pattern: /\b0\s+fail/i, label: 'Tests passing' },
  { pattern: /\b(?:done|finished|completed|shipped|merged)\b/i, label: 'Completion' },
  { pattern: /\bbumped?\s+version\b/i, label: 'Version bump' },
  { pattern: /\bv\d+\.\d+/i, label: 'Version bump' },
];

export class ProactiveDetector implements IProactiveDetector {
  /**
   * Detect save-worthy events from user prompt and optional assistant context.
   */
  detect(userPrompt: string, previousAssistantMessage?: string): IProactiveDetection {
    const noSuggestion: IProactiveDetection = { shouldSuggest: false };

    if (!userPrompt || !userPrompt.trim()) {
      return noSuggestion;
    }

    // Check for decision confirmation first (requires both user + assistant context)
    const decisionResult = this.detectDecision(userPrompt, previousAssistantMessage);
    if (decisionResult.shouldSuggest) {
      return decisionResult;
    }

    // Check for milestone patterns in user prompt
    const milestoneResult = this.detectMilestone(userPrompt);
    if (milestoneResult.shouldSuggest) {
      return milestoneResult;
    }

    return noSuggestion;
  }

  /**
   * Detect decision confirmation: user confirms after assistant presented options.
   */
  private detectDecision(userPrompt: string, assistantMessage?: string): IProactiveDetection {
    if (!assistantMessage) {
      return { shouldSuggest: false };
    }

    const isConfirmation = CONFIRMATION_PATTERN.test(userPrompt.trim());
    const hasOptions = OPTION_PRESENTING_PATTERN.test(assistantMessage);

    if (isConfirmation && hasOptions) {
      const topic = this.extractDecisionTopic(assistantMessage);
      return {
        shouldSuggest: true,
        suggestedFact: `DECISION: ${topic}`,
        factType: 'decision',
        confidence: 'high',
      };
    }

    return { shouldSuggest: false };
  }

  /**
   * Detect milestone patterns in user prompt.
   */
  private detectMilestone(userPrompt: string): IProactiveDetection {
    for (const { pattern, label } of MILESTONE_PATTERNS) {
      if (pattern.test(userPrompt)) {
        const summary = this.extractMilestoneSummary(userPrompt, label);
        return {
          shouldSuggest: true,
          suggestedFact: `MILESTONE: ${summary}`,
          factType: 'milestone',
          confidence: 'medium',
        };
      }
    }

    return { shouldSuggest: false };
  }

  /**
   * Extract a concise topic from the assistant message that presented options.
   */
  private extractDecisionTopic(assistantMessage: string): string {
    // Take the first sentence or first 80 chars
    const trimmed = assistantMessage.trim();
    const normalized = trimmed.replace(/^[\s\W_]+/, '');
    const candidate = normalized || trimmed;
    const firstSentence = candidate.split(/[.!?\n]/)[0]?.trim() ?? '';
    if (!firstSentence) {
      return candidate.slice(0, 80) || 'Decision made';
    }
    if (firstSentence.length <= 80) {
      return firstSentence;
    }
    return firstSentence.slice(0, 77) + '...';
  }

  /**
   * Extract a concise summary from the user prompt for a milestone.
   */
  private extractMilestoneSummary(userPrompt: string, label: string): string {
    // Take the first sentence or first 80 chars of the prompt
    const trimmed = userPrompt.trim();
    const normalized = trimmed.replace(/^[\s\W_]+/, '');
    const candidate = normalized || trimmed;
    const firstSentence = candidate.split(/[.!?\n]/)[0]?.trim() ?? '';
    if (!firstSentence) {
      return candidate.slice(0, 80) || label;
    }
    if (firstSentence.length <= 80) {
      return firstSentence;
    }
    return firstSentence.slice(0, 77) + '...';
  }
}

/**
 * Factory function for creating a ProactiveDetector instance.
 */
export function createProactiveDetector(): IProactiveDetector {
  return new ProactiveDetector();
}
