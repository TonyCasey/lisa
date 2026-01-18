/**
 * Transcript Finder - Locate Claude Code session transcripts
 *
 * Provides functions for finding transcript files, handling
 * stale paths and searching common locations.
 */

const fs = require('fs');
const path = require('path');

// Import from common module
const { findMostRecentTranscript } = require('../common/transcript-parser');

// =============================================================================
// Configuration
// =============================================================================

/** Common session directory locations (relative to home) */
export const SESSION_DIR_PATHS = ['.claude/projects', '.claude-code/sessions'];

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the user's home directory
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

/**
 * Get common session directory paths
 */
export function getSessionDirs(): string[] {
  const homeDir = getHomeDir();
  return SESSION_DIR_PATHS.map((p) => path.join(homeDir, p));
}

// =============================================================================
// Transcript Finding
// =============================================================================

/**
 * Find transcript file, handling known bugs with stale paths
 *
 * Search strategy:
 * 1. Try provided path directly
 * 2. Search parent directory of provided path
 * 3. Search common session locations
 *
 * @param providedPath - Path provided by the hook (may be stale)
 * @returns Path to transcript file or null if not found
 */
export function findTranscript(providedPath: string): string | null {
  // 1. Try provided path first
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }

  // 2. Fall back to finding most recent transcript in the session directory
  if (providedPath) {
    const dir = path.dirname(providedPath);
    if (fs.existsSync(dir)) {
      const found = findMostRecentTranscript(dir);
      if (found) return found;
    }
  }

  // 3. Try common transcript locations
  const sessionDirs = getSessionDirs();

  for (const baseDir of sessionDirs) {
    if (fs.existsSync(baseDir)) {
      const found = findMostRecentTranscript(baseDir);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Check if a transcript path exists
 */
export function transcriptExists(transcriptPath: string): boolean {
  return fs.existsSync(transcriptPath);
}

/**
 * Get the directory containing a transcript
 */
export function getTranscriptDir(transcriptPath: string): string {
  return path.dirname(transcriptPath);
}
