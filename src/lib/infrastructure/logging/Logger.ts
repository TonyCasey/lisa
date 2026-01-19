import path from 'path';
import fs from 'fs';
import type { ILogger, ILoggerOptions, LogLevel } from '../../domain/interfaces';

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
 */
export class Logger implements ILogger {
  private readonly options: ILoggerOptions;
  private readonly getCorrelationId: () => string | undefined;
  private readonly logFile: string;
  private readonly bindings: Record<string, unknown>;

  constructor(
    options: ILoggerOptions,
    _pinoInstance?: unknown, // Kept for API compatibility
    getCorrelationId?: () => string | undefined,
    bindings?: Record<string, unknown>
  ) {
    this.options = options;
    this.getCorrelationId = getCorrelationId ?? (() => undefined);
    this.bindings = bindings ?? {};

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
      try {
        fs.appendFileSync(this.logFile, fileLine);
      } catch {
        // Silently fail if we can't write to the file
      }
    }

    // Console output: colorized
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
      this.options,
      undefined,
      this.getCorrelationId,
      { ...this.bindings, ...bindings }
    );
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.options.level];
  }
}

/**
 * No-op logger for testing or when logging is disabled.
 */
export class NullLogger implements ILogger {
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
}
