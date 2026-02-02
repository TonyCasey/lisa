/**
 * IProactiveDetector
 *
 * Detects save-worthy events during conversation (decisions, milestones)
 * and returns non-blocking save suggestions for context injection.
 */

/**
 * Result of proactive detection analysis.
 */
export interface IProactiveDetection {
  /** Whether a save suggestion should be shown */
  readonly shouldSuggest: boolean;
  /** Suggested fact text to save */
  readonly suggestedFact?: string;
  /** Type of the detected event */
  readonly factType?: 'decision' | 'milestone';
  /** Confidence level for the detection */
  readonly confidence?: 'high' | 'medium';
}

/**
 * Service that detects save-worthy events from user prompts
 * and optional previous assistant messages.
 */
export interface IProactiveDetector {
  /**
   * Analyze a user prompt (and optionally the preceding assistant message)
   * for save-worthy patterns.
   *
   * @param userPrompt - The current user prompt
   * @param previousAssistantMessage - The last assistant message (optional)
   * @returns Detection result with optional save suggestion
   */
  detect(userPrompt: string, previousAssistantMessage?: string): IProactiveDetection;
}
