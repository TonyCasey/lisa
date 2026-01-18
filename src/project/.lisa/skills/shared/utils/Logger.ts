/**
 * Shared pino-based logging utility for Lisa skills.
 * 
 * Configuration (via environment or .lisa/.env):
 *   LOG_LEVEL=debug|info|warn|error (default: error)
 *   LOG_DIR=.lisa/logs (default)
 *   LOG_CONSOLE=true|false (default: false)
 */
import type { ILogger, ILoggerConfig, LogLevel } from './interfaces';
import pino, { Logger as PinoLogger } from 'pino';
import path from 'path';
import fs from 'fs';

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
function loadLoggerConfig(name: string): {
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
 * Creates a pino-based logger instance.
 */
export function createLogger(name: string, config?: ILoggerConfig): ILogger {
  const loadedConfig = loadLoggerConfig(name);
  const level = config?.level ?? loadedConfig.level;
  const logDir = config?.destination ?? loadedConfig.logDir;
  const enableConsole = config?.prettyPrint ?? loadedConfig.enableConsole;

  // Build pino transports
  const targets: pino.TransportTargetOptions[] = [];

  // Console transport (pretty printing)
  if (enableConsole) {
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
      level,
    });
  }

  // File transport
  ensureLogDir(logDir);
  const logFile = path.join(logDir, `skills-${getDateString()}.log`);

  targets.push({
    target: 'pino/file',
    options: {
      destination: logFile,
      mkdir: true,
    },
    level,
  });

  const transport = pino.transport({ targets });
  const pinoLogger = pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport
  ).child({ source: name });

  return createLoggerFromPino(pinoLogger, name);
}

/**
 * Creates an ILogger wrapper around a pino logger.
 */
function createLoggerFromPino(pinoLogger: PinoLogger, source: string): ILogger {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      pinoLogger.debug(context ?? {}, message);
    },

    info(message: string, context?: Record<string, unknown>): void {
      pinoLogger.info(context ?? {}, message);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      pinoLogger.warn(context ?? {}, message);
    },

    error(message: string, context?: Record<string, unknown>): void {
      pinoLogger.error(context ?? {}, message);
    },

    child(bindings: Record<string, unknown>): ILogger {
      const childPino = pinoLogger.child(bindings);
      return createLoggerFromPino(childPino, source);
    },
  };
}

/**
 * Creates a simple console logger (no file output).
 * Useful for testing or when pino is not available.
 */
export function createConsoleLogger(name: string): ILogger {
  const prefix = `[${name}]`;

  function log(
    level: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.error(`${new Date().toISOString()} ${level} ${prefix} ${message}${contextStr}`);
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
        ? `${name}:${bindings.source}`
        : name;
      return createConsoleLogger(childName);
    },
  };

  return logger;
}

// Export singleton instance for convenience
export const logger = createLogger('lisa');
