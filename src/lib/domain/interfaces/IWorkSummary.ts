/**
 * Work Summary Interface.
 *
 * Represents a parsed summary of work performed during a coding session.
 * Used by both the session capture service (infrastructure) and the
 * transcript enricher (domain contract).
 *
 * Lives in the domain layer so that domain interfaces (ITranscriptEnricher)
 * can reference it without crossing the architecture boundary.
 */

/**
 * Parsed work summary from a session transcript.
 */
export interface IWorkSummary {
  readonly messageCount: number;
  readonly userPrompts: number;
  readonly assistantResponses: number;
  readonly toolCalls: number;
  readonly filesCreated: readonly string[];
  readonly filesModified: readonly string[];
  readonly duration: number;
  readonly summary: string;
}
