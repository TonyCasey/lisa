/**
 * Shared logging utility for Lisa skills.
 *
 * Configuration (via environment or .lisa/.env):
 *   LOG_LEVEL=debug|info|warn|error (default: error)
 *   LOG_DIR=.lisa/logs (default)
 *   LOG_CONSOLE=true|false (default: false)
 *
 * Log format: YYYY-MM-DD HH:mm:ss.SSS LEVEL [source] message {context}
 */
import type { ILogger, ILoggerConfig, LogLevel } from './interfaces';
import path from 'path';
import fs from 'fs';

// ANSI color codes for console output
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: COLORS.gray,
  INFO: COLORS.blue,
  WARN: COLORS.yellow,
  ERROR: COLORS.red,
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Get the .lisa directory path by traversing up from current file.
 */
function getLisaDir(): string {
  let dir = __dirname;

  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    const baseName = path.basename(dir);

    if (baseName === '.lisa') {
      return dir;
    }

    if (path.basename(parent) === '.lisa') {
      return parent;
    }

    dir = parent;
  }

  // Fallback: assume .lisa is at project root
  return path.join(process.cwd(), '.lisa');
}

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
 * Ensure log directory exists.
 */
function ensureLogDir(logDir: string): void {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch {
    // Silently fail if we can't create the directory
  }
}

/**
 * Load logger configuration from environment.
 */
function loadLoggerConfig(_name: string): {
  level: LogLevel;
  logDir: string;
  enableConsole: boolean;
} {
  const lisaDir = getLisaDir();
  const envPath = path.join(lisaDir, '.env');
  const env = readEnvFile(envPath);

  // Merge with process.env (process.env takes precedence)
  const level = (
    process.env.LOG_LEVEL ||
    env.LOG_LEVEL ||
    'error'
  ).toLowerCase() as LogLevel;
  const logDir =
    process.env.LOG_DIR || env.LOG_DIR || path.join(lisaDir, 'logs');
  const enableConsole =
    (process.env.LOG_CONSOLE || env.LOG_CONSOLE || 'false').toLowerCase() ===
    'true';

  // Validate level
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
  const validatedLevel = validLevels.includes(level) ? level : 'error';

  return {
    level: validatedLevel,
    logDir,
    enableConsole,
  };
}

/**
 * Creates a logger instance with file and optional console output.
 */
export function createLogger(name: string, config?: ILoggerConfig): ILogger {
  const loadedConfig = loadLoggerConfig(name);
  const level = config?.level ?? loadedConfig.level;
  const logDir = config?.destination ?? loadedConfig.logDir;
  const enableConsole = config?.prettyPrint ?? loadedConfig.enableConsole;

  // Ensure log directory exists
  ensureLogDir(logDir);
  const logFile = path.join(logDir, `skills-${getDateString()}.log`);

  /**
   * Check if a log level should be output.
   */
  function shouldLog(msgLevel: LogLevel): boolean {
    return LEVEL_PRIORITY[msgLevel] >= LEVEL_PRIORITY[level];
  }

  /**
   * Format context object as compact JSON string.
   */
  function formatContext(context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) return '';
    return ` ${JSON.stringify(context)}`;
  }

  /**
   * Write a log entry.
   */
  function writeLog(
    msgLevel: LogLevel,
    levelStr: string,
    source: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!shouldLog(msgLevel)) return;

    const timestamp = formatTimestamp(new Date());
    const contextStr = formatContext(context);

    // File output: plain single-line format
    const fileLine = `${timestamp} ${levelStr.padEnd(5)} [${source}] ${message}${contextStr}\n`;
    try {
      fs.appendFileSync(logFile, fileLine);
    } catch {
      // Silently fail if we can't write to the file
    }

    // Console output: colorized
    if (enableConsole) {
      const color = LEVEL_COLORS[levelStr] || COLORS.reset;
      const consoleLine = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${levelStr.padEnd(5)}${COLORS.reset} ${COLORS.cyan}[${source}]${COLORS.reset} ${message}${COLORS.gray}${contextStr}${COLORS.reset}`;
      console.error(consoleLine);
    }
  }

  /**
   * Create logger methods for a specific source.
   */
  function createLoggerMethods(source: string): ILogger {
    return {
      debug(message: string, context?: Record<string, unknown>): void {
        writeLog('debug', 'DEBUG', source, message, context);
      },

      info(message: string, context?: Record<string, unknown>): void {
        writeLog('info', 'INFO', source, message, context);
      },

      warn(message: string, context?: Record<string, unknown>): void {
        writeLog('warn', 'WARN', source, message, context);
      },

      error(message: string, context?: Record<string, unknown>): void {
        writeLog('error', 'ERROR', source, message, context);
      },

      child(bindings: Record<string, unknown>): ILogger {
        const childSource = bindings.source
          ? `${source}:${String(bindings.source)}`
          : source;
        return createLoggerMethods(childSource);
      },
    };
  }

  return createLoggerMethods(name);
}

/**
 * Creates a simple console logger (no file output).
 * Useful for testing or when file logging is not needed.
 */
export function createConsoleLogger(name: string): ILogger {
  function log(
    level: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const timestamp = formatTimestamp(new Date());
    const contextStr = context && Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : '';
    const color = LEVEL_COLORS[level] || COLORS.reset;
    console.error(
      `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${level.padEnd(5)}${COLORS.reset} ${COLORS.cyan}[${name}]${COLORS.reset} ${message}${COLORS.gray}${contextStr}${COLORS.reset}`
    );
  }

  const logger: ILogger = {
    debug(message: string, context?: Record<string, unknown>): void {
      log('DEBUG', message, context);
    },
    info(message: string, context?: Record<string, unknown>): void {
      log('INFO', message, context);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      log('WARN', message, context);
    },
    error(message: string, context?: Record<string, unknown>): void {
      log('ERROR', message, context);
    },
    child(bindings: Record<string, unknown>): ILogger {
      const childName = bindings.source
        ? `${name}:${String(bindings.source)}`
        : name;
      return createConsoleLogger(childName);
    },
  };

  return logger;
}

// Export singleton instance for convenience
export const logger = createLogger('lisa');
