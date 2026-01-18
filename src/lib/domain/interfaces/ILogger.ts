/**
 * Log levels supported by the logger.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger configuration options.
 */
export interface ILoggerOptions {
  /** Minimum log level to output. Default: 'info' */
  readonly level: LogLevel;
  /** Directory for log files. Default: '.lisa/logs' */
  readonly logDir: string;
  /** Enable console output. Default: true */
  readonly enableConsole: boolean;
  /** Enable file output. Default: true */
  readonly enableFile: boolean;
  /** Days to retain log files. Default: 7 */
  readonly retentionDays: number;
}

/**
 * Logger interface for structured logging.
 * 
 * Design principles:
 * - All methods accept an optional context object for structured data
 * - Child loggers inherit parent bindings
 * - Correlation IDs are automatically included when available
 * 
 * @example
 * ```typescript
 * const log = logger.child({ service: 'memory' });
 * log.info('Loading memories', { groupId: 'lisa', limit: 20 });
 * log.error('Failed to load', { error: err.message });
 * ```
 */
export interface ILogger {
  /**
   * Log at trace level (most verbose).
   * Use for detailed debugging information.
   */
  trace(message: string, context?: Record<string, unknown>): void;

  /**
   * Log at debug level.
   * Use for debugging information during development.
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log at info level.
   * Use for general operational information.
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log at warn level.
   * Use for unexpected but recoverable situations.
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log at error level.
   * Use for errors that need attention.
   */
  error(message: string, context?: Record<string, unknown>): void;

  /**
   * Log at fatal level.
   * Use for unrecoverable errors that cause shutdown.
   */
  fatal(message: string, context?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional bound context.
   * Child loggers include all parent bindings in every log entry.
   * 
   * @param bindings - Context to include in all child log entries
   * @returns A new logger with the bindings applied
   * 
   * @example
   * ```typescript
   * const serviceLog = logger.child({ service: 'memory' });
   * const opLog = serviceLog.child({ operation: 'load' });
   * opLog.info('Starting'); // includes service=memory, operation=load
   * ```
   */
  child(bindings: Record<string, unknown>): ILogger;

  /**
   * Check if a given log level is enabled.
   * Useful for avoiding expensive string formatting when level is disabled.
   * 
   * @param level - The level to check
   * @returns true if the level would be logged
   */
  isLevelEnabled(level: LogLevel): boolean;
}

/**
 * Factory function type for creating loggers.
 */
export type LoggerFactory = (options?: Partial<ILoggerOptions>) => ILogger;
