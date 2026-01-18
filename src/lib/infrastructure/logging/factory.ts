import path from 'path';
import fs from 'fs';
import type { ILogger, ILoggerOptions, LogLevel } from '../../domain/interfaces';
import { Logger, NullLogger, DEFAULT_LOGGER_OPTIONS } from './Logger';
import { getCorrelationId } from './context';

/**
 * Read .env file and return key-value pairs.
 */
function readEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      env[key] = val;
    });
  } catch {
    // .env file is optional
  }
  return env;
}

/**
 * Load logger options from environment.
 * Priority: process.env > .lisa/.env > defaults
 */
export function loadLoggerOptions(lisaDir?: string): ILoggerOptions {
  const resolvedAgentsDir = lisaDir ?? path.join(process.cwd(), '.lisa');
  const envPath = path.join(resolvedAgentsDir, '.env');
  const env = readEnvFile(envPath);

  // Get values with priority: process.env > .env file > default
  const level = (
    process.env.LOG_LEVEL ?? 
    env.LOG_LEVEL ?? 
    DEFAULT_LOGGER_OPTIONS.level
  ).toLowerCase() as LogLevel;

  const logDir = (
    process.env.LOG_DIR ?? 
    env.LOG_DIR ?? 
    path.join(resolvedAgentsDir, 'logs')
  );

  const enableConsole = (
    process.env.LOG_CONSOLE ?? 
    env.LOG_CONSOLE ?? 
    String(DEFAULT_LOGGER_OPTIONS.enableConsole)
  ).toLowerCase() === 'true';

  const enableFile = (
    process.env.LOG_FILE ?? 
    env.LOG_FILE ?? 
    String(DEFAULT_LOGGER_OPTIONS.enableFile)
  ).toLowerCase() === 'true';

  const retentionDays = parseInt(
    process.env.LOG_RETENTION_DAYS ?? 
    env.LOG_RETENTION_DAYS ?? 
    String(DEFAULT_LOGGER_OPTIONS.retentionDays),
    10
  );

  // Validate level
  const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const validatedLevel = validLevels.includes(level) ? level : DEFAULT_LOGGER_OPTIONS.level;

  return {
    level: validatedLevel,
    logDir,
    enableConsole,
    enableFile,
    retentionDays: isNaN(retentionDays) ? DEFAULT_LOGGER_OPTIONS.retentionDays : retentionDays,
  };
}

/**
 * Create a logger with the given options.
 * Automatically includes correlation IDs when available.
 * 
 * @param options - Logger options (uses environment defaults if not provided)
 * @returns A configured logger instance
 * 
 * @example
 * ```typescript
 * const logger = createLogger();
 * const serviceLog = logger.child({ service: 'memory' });
 * serviceLog.info('Loading memories');
 * ```
 */
export function createLogger(options?: Partial<ILoggerOptions>): ILogger {
  const resolvedOptions: ILoggerOptions = {
    ...loadLoggerOptions(),
    ...options,
  };

  return new Logger(resolvedOptions, undefined, getCorrelationId);
}

/**
 * Create a null logger (no-op).
 * Useful for testing or when logging should be disabled.
 */
export function createNullLogger(): ILogger {
  return new NullLogger();
}

/**
 * Singleton logger instance.
 * Lazily initialized on first access.
 */
let defaultLogger: ILogger | null = null;

/**
 * Get or create the default logger instance.
 * Uses environment configuration.
 */
export function getDefaultLogger(): ILogger {
  if (!defaultLogger) {
    defaultLogger = createLogger();
  }
  return defaultLogger;
}

/**
 * Reset the default logger (useful for testing).
 */
export function resetDefaultLogger(): void {
  defaultLogger = null;
}
