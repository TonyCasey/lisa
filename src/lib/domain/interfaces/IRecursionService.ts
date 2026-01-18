/**
 * Result of memory recursion for plan mode prompts.
 */
export interface IRecursionResult {
  /** Whether any relevant context was found */
  readonly hasContext: boolean;
  /** Previous decisions found in memory */
  readonly decisions: readonly string[];
  /** Learnings from retrospectives */
  readonly learnings: readonly string[];
  /** Related tasks */
  readonly relatedTasks: readonly string[];
  /** Formatted summary for output */
  readonly summary: string;
}

/**
 * Configuration for recursion service.
 */
export interface IRecursionConfig {
  /** Minimum prompt length to trigger recursion */
  readonly minPromptLength: number;
  /** Maximum results per category */
  readonly maxResultsPerType: number;
  /** Timeout for memory queries (ms) */
  readonly queryTimeoutMs: number;
}

/**
 * Service for searching memory when planning.
 * 
 * When a user submits a prompt in plan mode, this service searches
 * memory for relevant context: previous decisions, learnings, and tasks.
 */
export interface IRecursionService {
  /**
   * Run memory recursion for a plan mode prompt.
   * Searches for relevant decisions, learnings, and tasks.
   * 
   * @param prompt - The user's prompt text
   * @param groupIds - Hierarchical group IDs to search
   * @returns Recursion result with found context
   */
  run(prompt: string, groupIds: readonly string[]): Promise<IRecursionResult>;

  /**
   * Check if recursion should run for a given prompt.
   * 
   * @param prompt - The user's prompt text
   * @param permissionMode - The current permission mode
   * @returns True if recursion should run
   */
  shouldRun(prompt: string, permissionMode: string): boolean;
}
