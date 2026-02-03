import path from 'path';
import fs from 'fs';
import type {
  ILogger,
  ILoggerOptions,
  LogLevel,
  IStructuredLog,
  IStructuredLogger,
  ILogContext,
  LogEvent,
} from '../../domain/interfaces';
import { deriveCompleteEvent, deriveErrorEvent } from '../../domain/interfaces';

/**
 * Default logger configuration.
 */
export const DEFAULT_LOGGER_OPTIONS: ILoggerOptions = {
  level: 'info',
  logDir: '.lisa/logs',
  enableConsole: true,
  enableFile: true,
  retentionDays: 7,
};

/**
 * Extended logger options with async support.
 */
export interface ILoggerOptionsExtended extends ILoggerOptions {
  /** Use async file writes (fire-and-forget, non-blocking). Default: false. */
  asyncWrites?: boolean;
}

// ANSI color codes for console output
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const LEVEL_COLORS: Record<string, string> = {
  TRACE: COLORS.gray,
  DEBUG: COLORS.gray,
  INFO: COLORS.blue,
  WARN: COLORS.yellow,
  ERROR: COLORS.red,
  FATAL: COLORS.magenta,
};

/**
 * Map our log levels to numeric priorities.
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Format timestamp as YYYY-MM-DD HH:mm:ss.SSS
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Get today's date as YYYY-MM-DD.
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Simple file-based logger implementation.
 * Writes single-line formatted logs with optional colorized console output.
 * Also implements IStructuredLogger for standardized event logging.
 *
 * Supports async (non-blocking) file writes for performance-sensitive contexts
 * like Claude Code hooks where latency matters.
 */
export class Logger implements ILogger, IStructuredLogger {
  private readonly options: ILoggerOptionsExtended;
  private readonly getCorrelationId: () => string | undefined;
  private readonly logFile: string;
  private readonly bindings: Record<string, unknown>;
  private readonly boundContext: ILogContext;
  private readonly asyncWrites: boolean;

  constructor(
    options: ILoggerOptionsExtended,
    _pinoInstance?: unknown, // Kept for API compatibility
    getCorrelationId?: () => string | undefined,
    bindings?: Record<string, unknown>,
    boundContext?: ILogContext
  ) {
    this.options = options;
    this.getCorrelationId = getCorrelationId ?? (() => undefined);
    this.bindings = bindings ?? {};
    this.boundContext = boundContext ?? {};
    this.asyncWrites = options.asyncWrites ?? false;

    // Ensure log directory exists
    const logDir = path.resolve(options.logDir);
    this.ensureLogDir(logDir);
    this.logFile = path.join(logDir, `lisa-${getDateString()}.log`);
  }

  /**
   * Ensure log directory exists.
   */
  private ensureLogDir(logDir: string): void {
    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    } catch {
      // Silently fail if we can't create the directory
    }
  }

  /**
   * Check if a log level should be output.
   */
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.options.level];
  }

  /**
   * Format context object as compact JSON string.
   */
  private formatContext(context?: Record<string, unknown>): string {
    const merged = { ...this.bindings, ...context };
    const correlationId = this.getCorrelationId();
    if (correlationId) {
      merged.correlationId = correlationId;
    }
    if (Object.keys(merged).length === 0) return '';
    return ` ${JSON.stringify(merged)}`;
  }

  /**
   * Write a log entry.
   * Uses async (fire-and-forget) writes when asyncWrites is enabled.
   */
  private writeLog(
    level: LogLevel,
    levelStr: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    const timestamp = formatTimestamp(new Date());
    const contextStr = this.formatContext(context);

    // File output: plain single-line format
    if (this.options.enableFile) {
      const fileLine = `${timestamp} ${levelStr.padEnd(5)} ${message}${contextStr}\n`;
      if (this.asyncWrites) {
        // Fire-and-forget async write - doesn't block the event loop
        void (async () => {
          try {
            await fs.promises.appendFile(this.logFile, fileLine);
          } catch {
            // Silently ignore errors
          }
        })();
      } else {
        try {
          fs.appendFileSync(this.logFile, fileLine);
        } catch {
          // Silently fail if we can't write to the file
        }
      }
    }

    // Console output: colorized (always sync, goes to stderr)
    if (this.options.enableConsole) {
      const color = LEVEL_COLORS[levelStr] || COLORS.reset;
      const consoleLine = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${levelStr.padEnd(5)}${COLORS.reset} ${message}${COLORS.gray}${contextStr}${COLORS.reset}`;
      console.error(consoleLine);
    }
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.writeLog('trace', 'TRACE', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.writeLog('debug', 'DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.writeLog('info', 'INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.writeLog('warn', 'WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.writeLog('error', 'ERROR', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.writeLog('fatal', 'FATAL', message, context);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new Logger(
      { ...this.options, asyncWrites: this.asyncWrites },
      undefined,
      this.getCorrelationId,
      { ...this.bindings, ...bindings },
      this.boundContext
    );
  }

  // ============================================================================
  // IStructuredLogger Implementation
  // ============================================================================

  /**
   * Format a structured log entry into message and context.
   *
   * Note: log.data is flattened into the context object intentionally for better
   * compatibility with log aggregation tools (Elasticsearch, Datadog, etc.) that
   * prefer flat structures. Callers should avoid using keys in log.data that
   * conflict with reserved context fields (event, sessionId, groupId, etc.).
   */
  private formatStructuredLog(log: IStructuredLog): { message: string; context: Record<string, unknown> } {
    const context: Record<string, unknown> = {
      event: log.event,
      ...this.boundContext,
      ...log.context,
    };

    // Flatten data into context for log aggregation compatibility
    if (log.data) {
      Object.assign(context, log.data);
    }

    if (log.durationMs !== undefined) {
      context.durationMs = log.durationMs;
    }

    if (log.error) {
      context.error = log.error;
    }

    // Use event name as the message for consistency
    const message = `[${log.event}]`;

    return { message, context };
  }

  /**
   * Log a structured event at info level.
   */
  logEvent(log: IStructuredLog): void {
    const { message, context } = this.formatStructuredLog(log);
    this.info(message, context);
  }

  /**
   * Log a structured event at debug level.
   */
  logEventDebug(log: IStructuredLog): void {
    const { message, context } = this.formatStructuredLog(log);
    this.debug(message, context);
  }

  /**
   * Log a structured event at warn level.
   */
  logEventWarn(log: IStructuredLog): void {
    const { message, context } = this.formatStructuredLog(log);
    this.warn(message, context);
  }

  /**
   * Log a structured event at error level.
   */
  logEventError(log: IStructuredLog): void {
    const { message, context } = this.formatStructuredLog(log);
    this.error(message, context);
  }

  /**
   * Create a child logger with bound context.
   */
  withContext(context: ILogContext): IStructuredLogger {
    return new Logger(
      { ...this.options, asyncWrites: this.asyncWrites },
      undefined,
      this.getCorrelationId,
      this.bindings,
      { ...this.boundContext, ...context }
    );
  }

  /**
   * Start a timed operation and return a function to complete it.
   */
  startOperation(
    event: LogEvent | string,
    context?: ILogContext
  ): (result?: { data?: Record<string, unknown>; error?: string }) => void {
    const startTime = Date.now();
    const mergedContext = { ...this.boundContext, ...context };

    // Log the start event at debug level
    this.logEventDebug({
      event,
      context: mergedContext,
    });

    // Return a function to complete the operation
    return (result?: { data?: Record<string, unknown>; error?: string }) => {
      const durationMs = Date.now() - startTime;
      const completeEvent = result?.error
        ? deriveErrorEvent(event)
        : deriveCompleteEvent(event);

      if (result?.error) {
        this.logEventError({
          event: completeEvent,
          context: mergedContext,
          data: result?.data,
          durationMs,
          error: result.error,
        });
      } else {
        this.logEvent({
          event: completeEvent,
          context: mergedContext,
          data: result?.data,
          durationMs,
        });
      }
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.options.level];
  }
}

/**
 * No-op logger for testing or when logging is disabled.
 */
export class NullLogger implements ILogger, IStructuredLogger {
  trace(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  debug(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  error(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  fatal(_message: string, _context?: Record<string, unknown>): void {
    // No-op
  }

  child(_bindings: Record<string, unknown>): ILogger {
    return this;
  }

  isLevelEnabled(_level: LogLevel): boolean {
    return false;
  }

  // IStructuredLogger no-op implementations
  logEvent(_log: IStructuredLog): void {
    // No-op
  }

  logEventDebug(_log: IStructuredLog): void {
    // No-op
  }

  logEventWarn(_log: IStructuredLog): void {
    // No-op
  }

  logEventError(_log: IStructuredLog): void {
    // No-op
  }

  withContext(_context: ILogContext): IStructuredLogger {
    return this;
  }

  startOperation(
    _event: LogEvent | string,
    _context?: ILogContext
  ): (result?: { data?: Record<string, unknown>; error?: string }) => void {
    return () => {
      // No-op
    };
  }
}
