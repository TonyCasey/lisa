/**
 * Label inference interfaces for auto-labeling GitHub issues.
 *
 * Analyzes issue title and body content to suggest appropriate labels
 * based on conventional commit prefixes and content patterns.
 *
 * @see Issue #21: Auto-label issues based on content
 */

/**
 * Result of label inference analysis.
 */
export interface ILabelInferenceResult {
  /** Inferred labels based on content analysis */
  labels: string[];
  /** Explanation of why each label was suggested */
  reasons: Record<string, string>;
  /** Confidence score (0-1) for the inference */
  confidence: number;
}

/**
 * Options for label inference.
 */
export interface ILabelInferenceOptions {
  /** Include phase labels (phase:1, phase:2, etc.) */
  includePhaseLabels?: boolean;
  /** Include priority labels */
  includePriorityLabels?: boolean;
  /** Maximum number of labels to suggest */
  maxLabels?: number;
}

/**
 * Service interface for inferring labels from issue content.
 */
export interface ILabelInferenceService {
  /**
   * Analyze issue content and infer appropriate labels.
   *
   * @param title - Issue title
   * @param body - Issue body/description
   * @param options - Inference options
   * @returns Inference result with labels and reasons
   */
  inferLabels(
    title: string,
    body: string,
    options?: ILabelInferenceOptions
  ): ILabelInferenceResult;
}

/**
 * Label rule definition for pattern matching.
 */
export interface ILabelRule {
  /** Label to apply when pattern matches */
  label: string;
  /** Patterns to match in title (case-insensitive) */
  titlePatterns?: RegExp[];
  /** Patterns to match in body (case-insensitive) */
  bodyPatterns?: RegExp[];
  /** Prefix patterns for conventional commit style titles */
  prefixPatterns?: RegExp[];
  /** Human-readable description of why this label applies */
  reason: string;
  /** Priority for ordering when multiple rules match (higher = more important) */
  priority?: number;
}
