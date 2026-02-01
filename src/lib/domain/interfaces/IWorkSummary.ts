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
  messageCount: number;
  userPrompts: number;
  assistantResponses: number;
  toolCalls: number;
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  summary: string;
}
