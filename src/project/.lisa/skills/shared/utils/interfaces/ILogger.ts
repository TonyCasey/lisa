/**
 * Interface for logging operations.
 * Provides structured logging with context support.
 */
export interface ILogger {
  /**
   * Log a debug message.
   * @param message - Log message
   * @param context - Optional structured context
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an info message.
   * @param message - Log message
   * @param context - Optional structured context
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log a warning message.
   * @param message - Log message
   * @param context - Optional structured context
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error message.
   * @param message - Log message
   * @param context - Optional structured context
   */
  error(message: string, context?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional bindings.
   * @param bindings - Context bindings to include in all messages
   * @returns A new logger instance with the bindings
   */
  child(bindings: Record<string, unknown>): ILogger;
}

/**
 * Log levels in order of severity.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Configuration options for creating a logger.
 */
export interface ILoggerConfig {
  /** Logger name/component identifier */
  name: string;
  /** Minimum log level to output */
  level?: LogLevel;
  /** Output destination ('stdout', 'stderr', or file path) */
  destination?: string;
  /** Pretty print for development */
  prettyPrint?: boolean;
}
