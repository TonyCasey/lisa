/**
 * Capture Module - Work capture for session-stop
 *
 * This module provides functions for capturing and analyzing
 * work done during a Claude Code session.
 */

// Transcript finding
export {
  findTranscript,
  transcriptExists,
  getTranscriptDir,
  getHomeDir,
  getSessionDirs,
  SESSION_DIR_PATHS,
} from './transcript-finder';

// Retrospective building
export {
  analyzeFilePatterns,
  detectNamingPatterns,
  formatNamingPatterns,
  buildRetrospective,
  formatRetrospectiveForStorage,
  type IPatternAnalysis,
  type INamingPatterns,
} from './retrospective-builder';

// Local logging
export {
  appendWorkSession,
  logError,
  buildWorkLogEntry,
  rotateLogsIfNeeded,
  ensureLogsDir,
  getLogsDir,
  getWorkSessionsPath,
  getErrorLogPath,
  DEFAULT_LOGS_DIR,
  WORK_SESSIONS_FILE,
  ERROR_LOG_FILE,
  MAX_LOG_SIZE,
  type IWorkLogEntry,
  type ILogOptions,
} from './local-logger';

// Summary building
export {
  buildGraphitiSummary,
  buildGraphitiTags,
  buildRetrospectiveTags,
  shouldSaveToGraphiti,
  hasSignificantWork,
  type IWorkSummary,
  type IComplexityRating,
  type ISummaryOptions,
} from './summary-builder';
