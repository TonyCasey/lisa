/**
 * Structured logging interfaces and event definitions.
 *
 * Provides standardized event names and context fields for log aggregation
 * and observability tooling.
 *
 * @see Issue #16: Add structured log enrichment with context fields
 */

/**
 * Standardized event names for log filtering and aggregation.
 *
 * Format: `{domain}:{operation}:{status}`
 * - domain: memory, task, session, handler
 * - operation: load, save, search, capture, sync
 * - status: start, complete, error, timeout
 */
export const LogEvents = {
  // Memory operations
  MEMORY_LOAD_START: 'memory:load:start',
  MEMORY_LOAD_COMPLETE: 'memory:load:complete',
  MEMORY_LOAD_ERROR: 'memory:load:error',
  MEMORY_LOAD_TIMEOUT: 'memory:load:timeout',
  MEMORY_SAVE_START: 'memory:save:start',
  MEMORY_SAVE_COMPLETE: 'memory:save:complete',
  MEMORY_SAVE_ERROR: 'memory:save:error',
  MEMORY_SEARCH_START: 'memory:search:start',
  MEMORY_SEARCH_COMPLETE: 'memory:search:complete',
  MEMORY_SEARCH_ERROR: 'memory:search:error',

  // Task operations
  TASK_LOAD_START: 'task:load:start',
  TASK_LOAD_COMPLETE: 'task:load:complete',
  TASK_LOAD_ERROR: 'task:load:error',
  TASK_SYNC_START: 'task:sync:start',
  TASK_SYNC_COMPLETE: 'task:sync:complete',
  TASK_SYNC_ERROR: 'task:sync:error',

  // Session operations
  SESSION_START: 'session:start',
  SESSION_STOP: 'session:stop',
  SESSION_CAPTURE_START: 'session:capture:start',
  SESSION_CAPTURE_COMPLETE: 'session:capture:complete',
  SESSION_CAPTURE_ERROR: 'session:capture:error',

  // Handler operations
  HANDLER_START: 'handler:start',
  HANDLER_COMPLETE: 'handler:complete',
  HANDLER_ERROR: 'handler:error',

  // DAL operations
  DAL_CONNECT_START: 'dal:connect:start',
  DAL_CONNECT_COMPLETE: 'dal:connect:complete',
  DAL_CONNECT_ERROR: 'dal:connect:error',
  DAL_FALLBACK: 'dal:fallback',

  // MCP operations
  MCP_CALL_START: 'mcp:call:start',
  MCP_CALL_COMPLETE: 'mcp:call:complete',
  MCP_CALL_ERROR: 'mcp:call:error',
} as const;

/**
 * Type for log event names.
 */
export type LogEvent = (typeof LogEvents)[keyof typeof LogEvents];

/**
 * Context fields included in structured logs.
 * These fields enable correlation and filtering across log entries.
 */
export interface ILogContext {
  /** MCP/CLI session identifier */
  sessionId?: string;
  /** Memory group identifier */
  groupId?: string;
  /** Project directory path */
  projectRoot?: string;
  /** Request correlation ID for tracing */
  correlationId?: string;
  /** Current operation being performed */
  operation?: string;
  /** Git branch name */
  branch?: string;
  /** Backend source (mcp, neo4j, zep) */
  backend?: string;
}

/**
 * Structured log entry for consistent log formatting.
 */
export interface IStructuredLog {
  /** Standardized event name */
  event: LogEvent | string;
  /** Log context for correlation */
  context?: ILogContext;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Operation duration in milliseconds */
  durationMs?: number;
  /** Error message if applicable */
  error?: string;
}

/**
 * Extended logger interface with structured event logging.
 */
export interface IStructuredLogger {
  /**
   * Log a structured event at info level.
   *
   * @param log - Structured log entry
   *
   * @example
   * ```typescript
   * logger.logEvent({
   *   event: LogEvents.MEMORY_LOAD_COMPLETE,
   *   context: { sessionId, groupId },
   *   data: { factCount: 15, nodeCount: 8 },
   *   durationMs: 234,
   * });
   * ```
   */
  logEvent(log: IStructuredLog): void;

  /**
   * Log a structured event at debug level.
   */
  logEventDebug(log: IStructuredLog): void;

  /**
   * Log a structured event at warn level.
   */
  logEventWarn(log: IStructuredLog): void;

  /**
   * Log a structured event at error level.
   */
  logEventError(log: IStructuredLog): void;

  /**
   * Create a child logger with bound context.
   * All events logged by the child will include the bound context.
   *
   * @param context - Context to bind to all child log entries
   */
  withContext(context: ILogContext): IStructuredLogger;

  /**
   * Start a timed operation and return a function to complete it.
   * Automatically calculates duration when complete() is called.
   *
   * @param event - Event name for start/complete logging
   * @param context - Optional context for the operation
   *
   * @example
   * ```typescript
   * const complete = logger.startOperation(LogEvents.MEMORY_LOAD_START);
   * // ... do work ...
   * complete({ data: { factCount: 15 } });
   * ```
   */
  startOperation(
    event: LogEvent | string,
    context?: ILogContext
  ): (result?: { data?: Record<string, unknown>; error?: string }) => void;
}

/**
 * Helper to create a correlation ID.
 * Uses a base36 timestamp and random suffix for uniqueness.
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Helper to derive the complete event name from a start event.
 * e.g., 'memory:load:start' -> 'memory:load:complete'
 */
export function deriveCompleteEvent(startEvent: string): string {
  return startEvent.replace(':start', ':complete');
}

/**
 * Helper to derive the error event name from a start event.
 * e.g., 'memory:load:start' -> 'memory:load:error'
 */
export function deriveErrorEvent(startEvent: string): string {
  return startEvent.replace(':start', ':error');
}
