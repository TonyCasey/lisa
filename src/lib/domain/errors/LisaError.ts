/**
 * Base error class for Lisa domain errors.
 */
export class LisaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LisaError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when MCP communication fails.
 */
export class McpError extends LisaError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    data?: Record<string, unknown>
  ) {
    super(message, 'MCP_ERROR', { ...data, statusCode });
    this.name = 'McpError';
  }
}

/**
 * Error thrown when memory operations fail.
 */
export class MemoryError extends LisaError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(message, 'MEMORY_ERROR', data);
    this.name = 'MemoryError';
  }
}

/**
 * Error thrown when task operations fail.
 */
export class TaskError extends LisaError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(message, 'TASK_ERROR', data);
    this.name = 'TaskError';
  }
}

/**
 * Error thrown when context detection fails.
 */
export class ContextError extends LisaError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(message, 'CONTEXT_ERROR', data);
    this.name = 'ContextError';
  }
}

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends LisaError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    data?: Record<string, unknown>
  ) {
    super(message, 'TIMEOUT_ERROR', { ...data, timeoutMs });
    this.name = 'TimeoutError';
  }
}
