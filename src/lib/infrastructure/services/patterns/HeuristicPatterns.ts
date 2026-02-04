/**
 * Heuristic Patterns for Git Extraction
 *
 * Regex patterns for extracting structured facts from PR descriptions,
 * review comments, and issue bodies without requiring LLM calls.
 *
 * Part of LISA-9: Phase 3 Git-Powered Memory Extraction.
 */

import type { HeuristicFactType } from '../../../domain/interfaces/IGitExtractor';

/**
 * Pattern definition with associated fact type and confidence.
 */
export interface IPatternDefinition {
  /** The regex pattern to match. */
  readonly pattern: RegExp;
  /** The fact type this pattern extracts. */
  readonly factType: HeuristicFactType;
  /** Name of the pattern for tagging. */
  readonly name: string;
  /** Base confidence level for matches. */
  readonly baseConfidence: 'high' | 'medium' | 'low';
  /** Minimum match length to be considered valid. */
  readonly minLength: number;
}

/**
 * Decision patterns - extract motivations, trade-offs, and rationale.
 */
export const DECISION_PATTERNS: readonly IPatternDefinition[] = [
  {
    pattern: /(?:because|since)\s+(.{20,300}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'because-clause',
    baseConfidence: 'medium',
    minLength: 25,
  },
  {
    pattern: /(?:instead of|rather than)\s+(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'instead-of',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:decided|chose|chosen)\s+(?:to\s+)?(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'decided-to',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:trade-?off|tradeoff)[:\s]+(.{20,300}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'tradeoff',
    baseConfidence: 'high',
    minLength: 25,
  },
  {
    pattern: /##\s*(?:Why|Motivation|Rationale)\s*\n+(.{30,500}?)(?:\n##|\n\n|$)/gi,
    factType: 'decision',
    name: 'why-section',
    baseConfidence: 'high',
    minLength: 40,
  },
  {
    pattern: /(?:the reason|reasoning)[:\s]+(.{20,250}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'reasoning',
    baseConfidence: 'medium',
    minLength: 25,
  },
  {
    pattern: /(?:this approach|this solution)\s+(.{20,200}?)(?:\.|$|\n)/gi,
    factType: 'decision',
    name: 'approach',
    baseConfidence: 'medium',
    minLength: 25,
  },
];

/**
 * Gotcha patterns - extract warnings, workarounds, and caveats.
 */
export const GOTCHA_PATTERNS: readonly IPatternDefinition[] = [
  {
    pattern: /(?:careful|caution|warning)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'careful',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:gotcha|caveat|pitfall)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'gotcha',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:workaround|hack)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'workaround',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:don't forget|remember to|make sure)\s+(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'reminder',
    baseConfidence: 'medium',
    minLength: 20,
  },
  {
    pattern: /(?:important)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'important',
    baseConfidence: 'medium',
    minLength: 20,
  },
  {
    pattern: /(?:note)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'note',
    baseConfidence: 'low',
    minLength: 20,
  },
  {
    pattern: /(?:watch out|be aware|beware)[:\s]*(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'watch-out',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:breaking change)[:\s]*(.{15,300}?)(?:\.|$|\n)/gi,
    factType: 'gotcha',
    name: 'breaking-change',
    baseConfidence: 'high',
    minLength: 20,
  },
];

/**
 * Convention patterns - extract coding standards and guidelines.
 */
export const CONVENTION_PATTERNS: readonly IPatternDefinition[] = [
  {
    pattern: /(?:convention|pattern|standard)[:\s]+(.{15,250}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'convention',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:always)\s+(.{10,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'always',
    baseConfidence: 'medium',
    minLength: 15,
  },
  {
    pattern: /(?:never)\s+(.{10,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'never',
    baseConfidence: 'medium',
    minLength: 15,
  },
  {
    pattern: /(?:prefer)\s+(.{10,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'prefer',
    baseConfidence: 'medium',
    minLength: 15,
  },
  {
    pattern: /(?:avoid)\s+(.{10,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'avoid',
    baseConfidence: 'medium',
    minLength: 15,
  },
  {
    pattern: /(?:should\s+(?:always|never))\s+(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'should-rule',
    baseConfidence: 'high',
    minLength: 20,
  },
  {
    pattern: /(?:naming convention|naming pattern)[:\s]+(.{15,200}?)(?:\.|$|\n)/gi,
    factType: 'convention',
    name: 'naming',
    baseConfidence: 'high',
    minLength: 20,
  },
];

/**
 * All patterns combined for bulk matching.
 */
export const ALL_PATTERNS: readonly IPatternDefinition[] = [
  ...DECISION_PATTERNS,
  ...GOTCHA_PATTERNS,
  ...CONVENTION_PATTERNS,
];

/**
 * Match result from pattern extraction.
 */
export interface IPatternMatch {
  /** The extracted text content. */
  readonly text: string;
  /** The fact type. */
  readonly factType: HeuristicFactType;
  /** The pattern name that matched. */
  readonly patternName: string;
  /** Confidence level. */
  readonly confidence: 'high' | 'medium' | 'low';
  /** Start position in source text. */
  readonly startIndex: number;
}

/**
 * Extract all pattern matches from text.
 *
 * @param text - Source text to search
 * @param patterns - Patterns to match against (defaults to ALL_PATTERNS)
 * @returns Array of matches found
 */
export function extractPatternMatches(
  text: string,
  patterns: readonly IPatternDefinition[] = ALL_PATTERNS
): IPatternMatch[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const matches: IPatternMatch[] = [];
  const seenTexts = new Set<string>();

  for (const patternDef of patterns) {
    // Clone regex to reset lastIndex for global patterns
    // Ensure 'g' flag is present to prevent infinite loops with exec()
    const flags = patternDef.pattern.flags.includes('g')
      ? patternDef.pattern.flags
      : `${patternDef.pattern.flags}g`;
    const regex = new RegExp(patternDef.pattern.source, flags);
    regex.lastIndex = 0;  // Reset to be defensive
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const extractedText = match[1]?.trim();

      // Skip if no capture group or too short
      if (!extractedText || extractedText.length < patternDef.minLength) {
        continue;
      }

      // Skip duplicates (same text already extracted)
      const normalizedText = extractedText.toLowerCase();
      if (seenTexts.has(normalizedText)) {
        continue;
      }
      seenTexts.add(normalizedText);

      // Adjust confidence based on text length
      let confidence = patternDef.baseConfidence;
      if (extractedText.length > 100) {
        // Longer, more substantive matches get higher confidence
        if (confidence === 'low') confidence = 'medium';
      } else if (extractedText.length < 30) {
        // Very short matches get lower confidence
        if (confidence === 'high') confidence = 'medium';
        else if (confidence === 'medium') confidence = 'low';
      }

      matches.push({
        text: extractedText,
        factType: patternDef.factType,
        patternName: patternDef.name,
        confidence,
        startIndex: match.index,
      });
    }
  }

  return matches;
}

/**
 * Extract matches for a specific fact type.
 *
 * @param text - Source text to search
 * @param factType - Type of facts to extract
 * @returns Array of matches for the specified type
 */
export function extractByFactType(
  text: string,
  factType: HeuristicFactType
): IPatternMatch[] {
  const patterns = ALL_PATTERNS.filter(p => p.factType === factType);
  return extractPatternMatches(text, patterns);
}
