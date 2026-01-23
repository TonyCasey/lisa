/**
 * Label inference service implementation.
 *
 * Analyzes issue title and body content to suggest appropriate labels
 * based on conventional commit prefixes and content patterns.
 *
 * @see Issue #21: Auto-label issues based on content
 */

import type {
  ILabelInferenceService,
  ILabelInferenceResult,
  ILabelInferenceOptions,
  ILabelRule,
} from '../../domain/interfaces';

/**
 * Default label inference rules based on issue #21 specification.
 */
const DEFAULT_RULES: ILabelRule[] = [
  // Type labels - based on conventional commit prefixes
  {
    label: 'bug',
    prefixPatterns: [/^fix:/i, /^bug:/i, /^bugfix:/i],
    bodyPatterns: [/\bbug\b/i, /\bbroken\b/i, /\bincorrect\b/i, /\berror\b/i, /\bfail(s|ed|ing)?\b/i],
    reason: 'Content indicates a bug fix or error',
    priority: 10,
  },
  {
    label: 'enhancement',
    prefixPatterns: [/^feat:/i, /^feature:/i, /^add:/i],
    bodyPatterns: [/\badd(s|ed|ing)?\b/i, /\bimplement/i, /\bnew\b/i, /\benhance/i],
    reason: 'Content indicates a new feature or enhancement',
    priority: 10,
  },
  {
    label: 'documentation',
    prefixPatterns: [/^docs?:/i],
    bodyPatterns: [/\bdocument/i, /\breadme\b/i, /\bapi docs?\b/i],
    reason: 'Content relates to documentation',
    priority: 8,
  },
  {
    label: 'refactor',
    prefixPatterns: [/^refactor:/i, /^chore:/i],
    bodyPatterns: [/\brefactor/i, /\bclean\s*up\b/i, /\bmodularize/i, /\brestructure/i],
    reason: 'Content indicates refactoring or code cleanup',
    priority: 8,
  },
  {
    label: 'testing',
    prefixPatterns: [/^test:/i],
    bodyPatterns: [/\btest(s|ing)?\b/i, /\bcoverage\b/i, /\bunit test/i, /\bintegration test/i],
    reason: 'Content relates to testing',
    priority: 8,
  },

  // Priority labels
  {
    label: 'priority:high',
    bodyPatterns: [/\bbreak(s|ing)?\b/i, /\bblocking\b/i, /\bcritical\b/i, /\burgent\b/i, /\bsevere\b/i],
    reason: 'Content indicates high priority or urgency',
    priority: 15,
  },
  {
    label: 'priority:medium',
    bodyPatterns: [/\bshould\b/i, /\bimportant\b/i, /\bneeded\b/i],
    reason: 'Content indicates medium priority',
    priority: 5,
  },

  // Phase labels - based on Lisa project phases
  {
    label: 'phase:1',
    bodyPatterns: [/\breliability\b/i, /\btimeout\b/i, /\brace condition\b/i, /\bstale\b/i, /\bdeadlock\b/i],
    reason: 'Content relates to reliability (Phase 1)',
    priority: 6,
  },
  {
    label: 'phase:2',
    bodyPatterns: [/\btest coverage\b/i, /\bunit test/i, /\bintegration test/i, /\btest suite\b/i],
    reason: 'Content relates to testing (Phase 2)',
    priority: 6,
  },
  {
    label: 'phase:3',
    bodyPatterns: [/\bobservability\b/i, /\blogging\b/i, /\bdiagnostic/i, /\bmonitoring\b/i, /\btracing\b/i],
    reason: 'Content relates to observability (Phase 3)',
    priority: 6,
  },
  {
    label: 'phase:4',
    bodyPatterns: [/\bmaintainability\b/i, /\bmodular/i, /\bdocument/i, /\barchitecture\b/i],
    reason: 'Content relates to maintainability (Phase 4)',
    priority: 6,
  },
];

/**
 * Default options for label inference.
 */
const DEFAULT_OPTIONS: Required<ILabelInferenceOptions> = {
  includePhaseLabels: true,
  includePriorityLabels: true,
  maxLabels: 5,
};

/**
 * Label inference service implementation.
 */
export class LabelInferenceService implements ILabelInferenceService {
  private readonly rules: ILabelRule[];

  constructor(customRules?: ILabelRule[]) {
    this.rules = customRules ?? DEFAULT_RULES;
  }

  /**
   * Analyze issue content and infer appropriate labels.
   */
  inferLabels(
    title: string,
    body: string,
    options?: ILabelInferenceOptions
  ): ILabelInferenceResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const matchedRules: Array<{ rule: ILabelRule; matchType: 'prefix' | 'title' | 'body' }> = [];

    // Normalize inputs
    const normalizedTitle = title.trim();
    const normalizedBody = body.trim();

    // Check each rule
    for (const rule of this.rules) {
      // Skip phase labels if disabled
      if (!opts.includePhaseLabels && rule.label.startsWith('phase:')) {
        continue;
      }

      // Skip priority labels if disabled
      if (!opts.includePriorityLabels && rule.label.startsWith('priority:')) {
        continue;
      }

      // Check prefix patterns (highest confidence)
      if (rule.prefixPatterns) {
        for (const pattern of rule.prefixPatterns) {
          if (pattern.test(normalizedTitle)) {
            matchedRules.push({ rule, matchType: 'prefix' });
            break;
          }
        }
      }

      // Check title patterns
      if (rule.titlePatterns) {
        for (const pattern of rule.titlePatterns) {
          if (pattern.test(normalizedTitle)) {
            matchedRules.push({ rule, matchType: 'title' });
            break;
          }
        }
      }

      // Check body patterns
      if (rule.bodyPatterns) {
        for (const pattern of rule.bodyPatterns) {
          if (pattern.test(normalizedBody)) {
            matchedRules.push({ rule, matchType: 'body' });
            break;
          }
        }
      }
    }

    // Deduplicate and sort by priority
    const uniqueRules = this.deduplicateRules(matchedRules);
    const sortedRules = uniqueRules.sort((a, b) => {
      // Sort by match type first (prefix > title > body)
      const matchTypePriority = { prefix: 3, title: 2, body: 1 };
      const typeDiff = matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
      if (typeDiff !== 0) return typeDiff;

      // Then by rule priority
      return (b.rule.priority ?? 0) - (a.rule.priority ?? 0);
    });

    // Take top N labels
    const topRules = sortedRules.slice(0, opts.maxLabels);

    // Build result
    const labels: string[] = [];
    const reasons: Record<string, string> = {};

    for (const { rule, matchType } of topRules) {
      if (!labels.includes(rule.label)) {
        labels.push(rule.label);
        reasons[rule.label] = `${rule.reason} (matched in ${matchType})`;
      }
    }

    // Calculate confidence based on match types
    const confidence = this.calculateConfidence(topRules);

    return { labels, reasons, confidence };
  }

  /**
   * Deduplicate matched rules, keeping the highest priority match for each label.
   */
  private deduplicateRules(
    matchedRules: Array<{ rule: ILabelRule; matchType: 'prefix' | 'title' | 'body' }>
  ): Array<{ rule: ILabelRule; matchType: 'prefix' | 'title' | 'body' }> {
    const labelMap = new Map<string, { rule: ILabelRule; matchType: 'prefix' | 'title' | 'body' }>();

    for (const match of matchedRules) {
      const existing = labelMap.get(match.rule.label);
      if (!existing) {
        labelMap.set(match.rule.label, match);
      } else {
        // Keep the higher priority match type
        const matchTypePriority = { prefix: 3, title: 2, body: 1 };
        if (matchTypePriority[match.matchType] > matchTypePriority[existing.matchType]) {
          labelMap.set(match.rule.label, match);
        }
      }
    }

    return Array.from(labelMap.values());
  }

  /**
   * Calculate confidence score based on match types.
   */
  private calculateConfidence(
    rules: Array<{ rule: ILabelRule; matchType: 'prefix' | 'title' | 'body' }>
  ): number {
    if (rules.length === 0) return 0;

    // Prefix matches are highest confidence
    const hasPrefix = rules.some(r => r.matchType === 'prefix');
    if (hasPrefix) return 0.95;

    // Title matches are medium-high confidence
    const hasTitle = rules.some(r => r.matchType === 'title');
    if (hasTitle) return 0.8;

    // Body-only matches are medium confidence
    return 0.6;
  }
}

/**
 * Create a default label inference service.
 */
export function createLabelInferenceService(customRules?: ILabelRule[]): ILabelInferenceService {
  return new LabelInferenceService(customRules);
}
