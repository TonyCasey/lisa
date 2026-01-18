/**
 * Lightweight logger for Claude Code hooks.
 * 
 * Hooks run as standalone bundled scripts, so we can't use pino transports
 * (which require worker threads). This provides a simple file-based logger
 * that appends JSON lines to a log file.
 * 
 * Usage:
 *   import { createHookLogger } from './common/logger';
 *   const log = createHookLogger('session-start');
 *   log.info('Hook started', { trigger: 'startup' });
 */

const fs = require('fs');
const path = require('path');

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface IHookLogger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): IHookLogger;
}

interface LoggerConfig {
  level: LogLevel;
  logDir: string;
  enableConsole: boolean;
  enableFile: boolean;
}

// Log level numeric values for comparison
const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

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
 * Get the .lisa directory path.
 */
function getLisaDir(): string {
  // Try to find .lisa from cwd
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const lisaPath = path.join(dir, '.lisa');
    if (fs.existsSync(lisaPath)) {
      return lisaPath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to cwd/.lisa
  return path.join(process.cwd(), '.lisa');
}

/**
 * Load logger configuration from environment.
 */
function loadConfig(): LoggerConfig {
  const lisaDir = getLisaDir();
  const envPath = path.join(lisaDir, '.env');
  const env = readEnvFile(envPath);

  const level = (
    process.env.LOG_LEVEL ?? 
    env.LOG_LEVEL ?? 
    'info'
  ).toLowerCase() as LogLevel;

  const logDir = (
    process.env.LOG_DIR ?? 
    env.LOG_DIR ?? 
    path.join(lisaDir, 'logs')
  );

  // Hooks default to file-only logging (no console output to avoid interfering with hook output)
  const enableConsole = (
    process.env.LOG_CONSOLE ?? 
    env.LOG_CONSOLE ?? 
    'false'
  ).toLowerCase() === 'true';

  const enableFile = (
    process.env.LOG_FILE ?? 
    env.LOG_FILE ?? 
    'true'
  ).toLowerCase() === 'true';

  // Validate level
  const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const validatedLevel = validLevels.includes(level) ? level : 'info';

  return {
    level: validatedLevel,
    logDir,
    enableConsole,
    enableFile,
  };
}

/**
 * Ensure log directory exists.
 */
function ensureLogDir(logDir: string): void {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch {
    // Silently fail
  }
}

/**
 * Get today's date as YYYY-MM-DD for log file naming.
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Simple file-based logger that doesn't use worker threads.
 * Writes JSON lines directly to the log file.
 */
class SimpleFileLogger implements IHookLogger {
  private readonly logFile: string;
  private readonly minLevel: number;
  private readonly bindings: Record<string, unknown>;

  constructor(
    logDir: string,
    level: LogLevel,
    bindings: Record<string, unknown> = {}
  ) {
    ensureLogDir(logDir);
    this.logFile = path.join(logDir, `hooks-${getDateString()}.log`);
    this.minLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    this.bindings = bindings;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const entry = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...this.bindings,
      ...context,
    };

    try {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail - don't crash the hook
    }
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.log('trace', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('fatal', message, context);
  }

  child(bindings: Record<string, unknown>): IHookLogger {
    return new SimpleFileLogger(
      path.dirname(this.logFile),
      Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k as LogLevel] === this.minLevel) as LogLevel || 'info',
      { ...this.bindings, ...bindings }
    );
  }
}

/**
 * No-op logger for when logging should be disabled.
 */
class NullHookLogger implements IHookLogger {
  trace(): void { /* no-op */ }
  debug(): void { /* no-op */ }
  info(): void { /* no-op */ }
  warn(): void { /* no-op */ }
  error(): void { /* no-op */ }
  fatal(): void { /* no-op */ }
  child(): IHookLogger { return this; }
}

/**
 * Create a logger for a hook.
 * 
 * Uses a simple file-based logger that doesn't require worker threads,
 * making it safe for use in bundled hooks.
 * 
 * @param source - Hook name (e.g., 'session-start', 'session-stop')
 * @returns A logger instance
 */
export function createHookLogger(source: string): IHookLogger {
  const config = loadConfig();

  // If no logging enabled, return null logger
  if (!config.enableFile && !config.enableConsole) {
    return new NullHookLogger();
  }

  // Use simple file logger (no worker threads)
  if (config.enableFile) {
    return new SimpleFileLogger(config.logDir, config.level, { hook: source });
  }

  // Console-only not supported in hooks (would interfere with hook output)
  return new NullHookLogger();
}

// Export for CommonJS compatibility
module.exports = { createHookLogger };
