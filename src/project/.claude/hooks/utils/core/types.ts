/**
 * Core types for Claude Code hooks
 *
 * Shared interfaces used across hook modules for memory, tasks, and session data.
 * These types provide a consistent contract between modules.
 */

// =============================================================================
// Memory Types
// =============================================================================

/**
 * A memory item from Graphiti (fact or node)
 */
export interface IMemoryItem {
  uuid?: string;
  name?: string;
  fact?: string;
  tags?: string[];
  created_at?: string;
}

/**
 * Response structure from Graphiti memory queries
 */
export interface IMemoryResult {
  result?: {
    facts?: IMemoryItem[];
    nodes?: IMemoryItem[];
  };
  facts?: IMemoryItem[];
  nodes?: IMemoryItem[];
}

/**
 * Options for loading memory
 */
export interface IMemoryLoadOptions {
  aliases: string[];
  hierarchicalGroups: string[];
  branch: string | null;
  timeoutMs?: number;
}

/**
 * Result of loading memory with timeout support
 */
export interface IMemoryLoadResult {
  facts: IMemoryItem[];
  nodes: IMemoryItem[];
  tasks: IMemoryItem[];
  initReview: string | null;
  timedOut: boolean;
}

// =============================================================================
// Task Types
// =============================================================================

/**
 * A processed task with status and dependencies
 */
export interface ITask {
  key: string;
  status: string;
  title: string;
  blocked: string[];
  created_at?: string;
}

/**
 * Task counts by status
 */
export interface ITaskCounts {
  ready: number;
  'in-progress': number;
  blocked: number;
  done: number;
  closed: number;
  unknown: number;
  [key: string]: number;
}

/**
 * Summary of tasks for display
 */
export interface ITaskSummary {
  tasks: ITask[];
  counts: ITaskCounts;
  active: ITask[];
  ready: ITask[];
}

// =============================================================================
// Session Types
// =============================================================================

/**
 * Session start trigger types
 */
export type SessionTrigger = 'startup' | 'resume' | 'compact' | 'clear';

/**
 * Input from Claude Code session-start hook
 */
export interface ISessionStartInput {
  trigger?: SessionTrigger;
  session_type?: SessionTrigger;
}

/**
 * Input from Claude Code session-stop hook
 */
export interface ISessionStopInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/**
 * Input from Claude Code user-prompt-submit hook
 */
export interface IPromptSubmitInput {
  prompt?: string;
  permission_mode?: string;
  permissionMode?: string;
  [key: string]: unknown;
}

/**
 * Session context (repo, branch, user, etc.)
 */
export interface ISessionContext {
  repo: string;
  branch: string | null;
  aliases: string[];
  user: string;
  cwd: string;
  folderType: string;
  hierarchicalGroups: string[];
}

// =============================================================================
// Work Capture Types (session-stop)
// =============================================================================

/**
 * Summary of work done in a session
 */
export interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

/**
 * Complexity rating for work
 */
export interface IComplexityRating {
  rating: 1 | 2 | 3 | 4 | 5;
  rawScore: number;
  signals: string[];
  summary: string;
}

// =============================================================================
// Output Types
// =============================================================================

/**
 * Data for formatting session-start output
 */
export interface ISessionStartOutput {
  trigger: SessionTrigger;
  user: string;
  cwd: string;
  folderType: string;
  repo: string;
  branch: string | null;
  initReview: string | null;
  recentMemories: IMemoryItem[];
  taskSummary: ITaskSummary;
  timedOut: boolean;
}

/**
 * Result from Graphiti storage operations
 */
export interface IGraphitiResult {
  status: 'ok' | 'skipped' | 'error' | 'timeout' | 'unavailable';
  error?: string;
  raw?: string;
}

// =============================================================================
// Memory Group Types (for display)
// =============================================================================

/**
 * A group of memories clustered by time
 */
export interface IMemoryGroup {
  timestamp: Date;
  memories: IMemoryItem[];
  summary: string;
}
