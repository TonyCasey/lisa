/**
 * Local Logger - Save work sessions to local JSONL logs
 *
 * Provides functions for logging work sessions locally
 * with automatic rotation when files exceed size limits.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

/** Default logs directory name */
export const DEFAULT_LOGS_DIR = '.logs';

/** Default work sessions file name */
export const WORK_SESSIONS_FILE = 'work-sessions.jsonl';

/** Default error log file name */
export const ERROR_LOG_FILE = 'stop-hook-errors.log';

/** Maximum log file size before rotation (10 MB) */
export const MAX_LOG_SIZE = 10 * 1024 * 1024;

// =============================================================================
// Types
// =============================================================================

/**
 * Work session log entry
 */
export interface IWorkLogEntry {
  timestamp: string;
  sessionId: string;
  complexity: number;
  rawScore: number;
  signals: string[];
  summary: string;
  repo: string;
  branch: string | null;
  duration: string;
  durationMs: number;
  filesModified: string[];
  filesCreated: string[];
  commandCount: number;
  toolsUsed: Record<string, number>;
  assistantSummary: string;
}

/**
 * Options for logging
 */
export interface ILogOptions {
  /** Base directory for logs (default: cwd) */
  baseDir?: string;
  /** Logs subdirectory name (default: .logs) */
  logsDir?: string;
  /** Max log file size before rotation */
  maxSize?: number;
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the full path to the logs directory
 */
export function getLogsDir(options: ILogOptions = {}): string {
  const { baseDir = process.cwd(), logsDir = DEFAULT_LOGS_DIR } = options;
  return path.join(baseDir, logsDir);
}

/**
 * Get the full path to the work sessions log file
 */
export function getWorkSessionsPath(options: ILogOptions = {}): string {
  return path.join(getLogsDir(options), WORK_SESSIONS_FILE);
}

/**
 * Get the full path to the error log file
 */
export function getErrorLogPath(options: ILogOptions = {}): string {
  return path.join(getLogsDir(options), ERROR_LOG_FILE);
}

// =============================================================================
// Directory Management
// =============================================================================

/**
 * Ensure the logs directory exists
 */
export function ensureLogsDir(options: ILogOptions = {}): void {
  const logsDir = getLogsDir(options);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// =============================================================================
// Log Rotation
// =============================================================================

/**
 * Rotate log file if it exceeds max size
 *
 * @param logsFile - Path to the log file
 * @param maxSize - Maximum file size before rotation
 */
export function rotateLogsIfNeeded(
  logsFile: string,
  maxSize: number = MAX_LOG_SIZE
): void {
  if (!fs.existsSync(logsFile)) return;

  try {
    const stats = fs.statSync(logsFile);
    if (stats.size > maxSize) {
      const archiveDir = path.join(path.dirname(logsFile), 'archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = path.basename(logsFile, '.jsonl');
      const archivePath = path.join(archiveDir, `${baseName}-${timestamp}.jsonl`);
      fs.renameSync(logsFile, archivePath);
    }
  } catch {
    // Ignore rotation errors - don't fail the main operation
  }
}

// =============================================================================
// Logging Functions
// =============================================================================

/**
 * Append a work session entry to the log file
 *
 * @param entry - The log entry to append
 * @param options - Logging options
 */
export function appendWorkSession(
  entry: IWorkLogEntry,
  options: ILogOptions = {}
): void {
  const logsFile = getWorkSessionsPath(options);

  // Ensure directory exists
  ensureLogsDir(options);

  // Rotate if needed
  rotateLogsIfNeeded(logsFile, options.maxSize);

  // Append entry
  fs.appendFileSync(logsFile, JSON.stringify(entry) + '\n');
}

/**
 * Log an error to the error log file
 *
 * @param message - Error message
 * @param details - Additional details (optional)
 * @param options - Logging options
 */
export function logError(
  message: string,
  details?: string,
  options: ILogOptions = {}
): void {
  const errorLog = getErrorLogPath(options);

  try {
    ensureLogsDir(options);

    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${details ? `: ${details}` : ''}\n`;
    fs.appendFileSync(errorLog, entry);
  } catch {
    // Ignore log errors - don't fail silently but don't throw
  }
}

// =============================================================================
// Entry Building
// =============================================================================

/**
 * Build a work log entry from work summary and rating
 *
 * @param work - Work summary from transcript
 * @param rating - Complexity rating
 * @param sessionId - Session identifier
 * @param repo - Repository name
 * @param branch - Branch name
 * @param formatDuration - Duration formatter function
 * @returns Log entry object
 */
export function buildWorkLogEntry(
  work: {
    filesModified: Set<string>;
    filesCreated: Set<string>;
    commandsRun: string[];
    toolsUsed: Map<string, number>;
    assistantSummary: string;
    durationMs: number;
  },
  rating: {
    rating: number;
    rawScore: number;
    signals: string[];
    summary: string;
  },
  sessionId: string,
  repo: string,
  branch: string | null,
  formatDuration: (ms: number) => string
): IWorkLogEntry {
  return {
    timestamp: new Date().toISOString(),
    sessionId,
    complexity: rating.rating,
    rawScore: rating.rawScore,
    signals: rating.signals,
    summary: rating.summary,
    repo,
    branch,
    duration: formatDuration(work.durationMs),
    durationMs: work.durationMs,
    filesModified: Array.from(work.filesModified),
    filesCreated: Array.from(work.filesCreated),
    commandCount: work.commandsRun.length,
    toolsUsed: Object.fromEntries(work.toolsUsed),
    assistantSummary: work.assistantSummary.substring(0, 200),
  };
}
