import pino, { Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from 'pino';
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

/**
 * Map our log levels to pino levels.
 */
const LEVEL_MAP: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Pino-based logger implementation.
 * Wraps pino to implement ILogger interface with correlation ID support.
 */
export class Logger implements ILogger {
  private readonly pino: PinoLogger;
  private readonly options: ILoggerOptions;
  private readonly getCorrelationId: () => string | undefined;

  constructor(
    options: ILoggerOptions,
    pinoInstance?: PinoLogger,
    getCorrelationId?: () => string | undefined
  ) {
    this.options = options;
    this.getCorrelationId = getCorrelationId ?? (() => undefined);
    this.pino = pinoInstance ?? this.createPinoInstance(options);
  }

  /**
   * Create a pino instance with configured transports.
   */
  private createPinoInstance(options: ILoggerOptions): PinoLogger {
    const pinoOptions: PinoLoggerOptions = {
      level: options.level,
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    // In production or when file logging is enabled, use transports
    if (options.enableFile || options.enableConsole) {
      const targets: pino.TransportTargetOptions[] = [];

      // Console transport with pretty printing
      if (options.enableConsole) {
        targets.push({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
          level: options.level,
        });
      }

      // File transport with rotation
      if (options.enableFile) {
        const logDir = path.resolve(options.logDir);
        this.ensureLogDir(logDir);

        targets.push({
          target: 'pino-roll',
          options: {
            file: path.join(logDir, 'lisa'),
            frequency: 'daily',
            limit: { count: options.retentionDays },
            extension: '.log',
            mkdir: true,
          },
          level: options.level,
        });
      }

      if (targets.length > 0) {
        const transport = pino.transport({ targets });
        return pino(pinoOptions, transport);
      }
    }

    // Fallback to basic pino
    return pino(pinoOptions);
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
   * Add correlation ID to context if available.
   */
  private withCorrelation(context?: Record<string, unknown>): Record<string, unknown> {
    const correlationId = this.getCorrelationId();
    if (correlationId) {
      return { correlationId, ...context };
    }
    return context ?? {};
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.pino.trace(this.withCorrelation(context), message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.pino.debug(this.withCorrelation(context), message);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.pino.info(this.withCorrelation(context), message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.pino.warn(this.withCorrelation(context), message);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.pino.error(this.withCorrelation(context), message);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.pino.fatal(this.withCorrelation(context), message);
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new Logger(
      this.options,
      this.pino.child(bindings),
      this.getCorrelationId
    );
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_MAP[level] >= LEVEL_MAP[this.options.level];
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
