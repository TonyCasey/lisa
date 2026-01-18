"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
exports.createConsoleLogger = createConsoleLogger;
const pino_1 = __importDefault(require("pino"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Get the .lisa directory path by traversing up from current file.
 */
function getLisaDir() {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const parent = path_1.default.dirname(dir);
        const baseName = path_1.default.basename(dir);
        if (baseName === '.lisa') {
            return dir;
        }
        if (path_1.default.basename(parent) === '.lisa') {
            return parent;
        }
        dir = parent;
    }
    // Fallback: assume .lisa is at project root
    return path_1.default.join(process.cwd(), '.lisa');
}
/**
 * Read .env file and return key-value pairs.
 */
function readEnvFile(envPath) {
    const env = {};
    try {
        const raw = fs_1.default.readFileSync(envPath, 'utf8');
        raw.split(/\r?\n/).forEach((line) => {
            if (!line || line.startsWith('#'))
                return;
            const idx = line.indexOf('=');
            if (idx === -1)
                return;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            env[key] = val;
        });
    }
    catch {
        // .env file is optional
    }
    return env;
}
/**
 * Get today's date as YYYY-MM-DD.
 */
function getDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/**
 * Ensure log directory exists.
 */
function ensureLogDir(logDir) {
    try {
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
    }
    catch {
        // Silently fail if we can't create the directory
    }
}
/**
 * Load logger configuration from environment.
 */
function loadLoggerConfig(name) {
    const lisaDir = getLisaDir();
    const envPath = path_1.default.join(lisaDir, '.env');
    const env = readEnvFile(envPath);
    // Merge with process.env (process.env takes precedence)
    const level = (process.env.LOG_LEVEL ||
        env.LOG_LEVEL ||
        'error').toLowerCase();
    const logDir = process.env.LOG_DIR || env.LOG_DIR || path_1.default.join(lisaDir, 'logs');
    const enableConsole = (process.env.LOG_CONSOLE || env.LOG_CONSOLE || 'false').toLowerCase() ===
        'true';
    // Validate level
    const validLevels = ['debug', 'info', 'warn', 'error', 'silent'];
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
function createLogger(name, config) {
    const loadedConfig = loadLoggerConfig(name);
    const level = config?.level ?? loadedConfig.level;
    const logDir = config?.destination ?? loadedConfig.logDir;
    const enableConsole = config?.prettyPrint ?? loadedConfig.enableConsole;
    // Build pino transports
    const targets = [];
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
    const logFile = path_1.default.join(logDir, `skills-${getDateString()}.log`);
    targets.push({
        target: 'pino/file',
        options: {
            destination: logFile,
            mkdir: true,
        },
        level,
    });
    const transport = pino_1.default.transport({ targets });
    const pinoLogger = (0, pino_1.default)({
        level,
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
    }, transport).child({ source: name });
    return createLoggerFromPino(pinoLogger, name);
}
/**
 * Creates an ILogger wrapper around a pino logger.
 */
function createLoggerFromPino(pinoLogger, source) {
    return {
        debug(message, context) {
            pinoLogger.debug(context ?? {}, message);
        },
        info(message, context) {
            pinoLogger.info(context ?? {}, message);
        },
        warn(message, context) {
            pinoLogger.warn(context ?? {}, message);
        },
        error(message, context) {
            pinoLogger.error(context ?? {}, message);
        },
        child(bindings) {
            const childPino = pinoLogger.child(bindings);
            return createLoggerFromPino(childPino, source);
        },
    };
}
/**
 * Creates a simple console logger (no file output).
 * Useful for testing or when pino is not available.
 */
function createConsoleLogger(name) {
    const prefix = `[${name}]`;
    function log(level, message, context) {
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        console.error(`${new Date().toISOString()} ${level} ${prefix} ${message}${contextStr}`);
    }
    const logger = {
        debug(message, context) {
            log('DEBUG', message, context);
        },
        info(message, context) {
            log('INFO', message, context);
        },
        warn(message, context) {
            log('WARN', message, context);
        },
        error(message, context) {
            log('ERROR', message, context);
        },
        child(bindings) {
            const childName = bindings.source
                ? `${name}:${bindings.source}`
                : name;
            return createConsoleLogger(childName);
        },
    };
    return logger;
}
// Export singleton instance for convenience
exports.logger = createLogger('lisa');
//# sourceMappingURL=Logger.js.map