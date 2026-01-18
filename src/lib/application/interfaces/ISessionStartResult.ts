import type { IMemoryResult, ITask, ITaskCounts } from '../../domain';

/**
 * Result from handling a session start event.
 */
export interface ISessionStartResult {
  /** Human-readable message about what was loaded */
  readonly message: string;
  
  /** Loaded memory result */
  readonly memories: IMemoryResult;
  
  /** Processed tasks from memory */
  readonly tasks: readonly ITask[];
  
  /** Task counts by status */
  readonly taskCounts: ITaskCounts;
  
  /** 
   * Formatted content for injection into session context.
   * Used by OpenCode's output.context.push() and Claude Code's stdout.
   */
  readonly contextContent: string;
  
  /** Whether the load timed out (partial results) */
  readonly timedOut: boolean;
}
