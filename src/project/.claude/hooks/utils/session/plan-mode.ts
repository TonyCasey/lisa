/**
 * Plan Mode - State management for Claude Code plan mode
 *
 * Tracks whether plan mode context has been loaded to avoid
 * redundant loading on subsequent prompts in the same session.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

/** Time-to-live for plan mode state (30 minutes) */
export const PLAN_MODE_TTL_MS = 30 * 60 * 1000;

/** Default directory for state files */
export const DEFAULT_DEV_DIR = '.dev';

/** State file name */
export const PLAN_MODE_STATE_FILE = '.plan-mode-state.json';

// =============================================================================
// Types
// =============================================================================

/**
 * Plan mode state persisted to disk
 */
export interface IPlanModeState {
  loadedAt: string;
}

/**
 * Options for plan mode operations
 */
export interface IPlanModeOptions {
  /** Directory to store state file (default: .dev) */
  devDir?: string;
  /** TTL in milliseconds (default: 30 minutes) */
  ttlMs?: number;
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the path to the plan mode state file
 */
export function getPlanModeStatePath(devDir: string = DEFAULT_DEV_DIR): string {
  return path.join(devDir, PLAN_MODE_STATE_FILE);
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Read the current plan mode state from disk
 *
 * @param devDir - Directory containing the state file
 * @returns The state or null if not found/invalid
 */
export function readPlanModeState(devDir: string = DEFAULT_DEV_DIR): IPlanModeState | null {
  const statePath = getPlanModeStatePath(devDir);

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(content) as IPlanModeState;
  } catch {
    return null;
  }
}

/**
 * Write plan mode state to disk
 *
 * @param devDir - Directory to store the state file
 * @returns True if write succeeded
 */
export function writePlanModeState(devDir: string = DEFAULT_DEV_DIR): boolean {
  const statePath = getPlanModeStatePath(devDir);

  try {
    // Ensure directory exists
    if (!fs.existsSync(devDir)) {
      fs.mkdirSync(devDir, { recursive: true });
    }

    const state: IPlanModeState = {
      loadedAt: new Date().toISOString(),
    };

    fs.writeFileSync(statePath, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear plan mode state from disk
 *
 * @param devDir - Directory containing the state file
 * @returns True if clear succeeded (or file didn't exist)
 */
export function clearPlanModeState(devDir: string = DEFAULT_DEV_DIR): boolean {
  const statePath = getPlanModeStatePath(devDir);

  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if plan mode state has expired
 *
 * @param state - The state to check
 * @param ttlMs - TTL in milliseconds
 * @returns True if expired or invalid
 */
export function isPlanModeStateExpired(
  state: IPlanModeState | null,
  ttlMs: number = PLAN_MODE_TTL_MS
): boolean {
  if (!state) {
    return true;
  }

  try {
    const ageMs = Date.now() - new Date(state.loadedAt).getTime();
    return ageMs >= ttlMs;
  } catch {
    return true;
  }
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Check if we should load plan context
 *
 * Returns true only on first entry into plan mode within the TTL window.
 * Automatically clears state when not in plan mode.
 * Automatically marks state as loaded when returning true.
 *
 * @param isPlanMode - Whether currently in plan mode
 * @param options - Configuration options
 * @returns True if context should be loaded
 */
export function shouldLoadPlanContext(
  isPlanMode: boolean,
  options: IPlanModeOptions = {}
): boolean {
  const { devDir = DEFAULT_DEV_DIR, ttlMs = PLAN_MODE_TTL_MS } = options;

  // Not in plan mode - clear state if exists
  if (!isPlanMode) {
    clearPlanModeState(devDir);
    return false;
  }

  // In plan mode - check if we already loaded context recently
  const state = readPlanModeState(devDir);
  if (state && !isPlanModeStateExpired(state, ttlMs)) {
    // Context was loaded recently - skip
    return false;
  }

  // First time in plan mode (or expired) - mark as loaded and return true
  writePlanModeState(devDir);
  return true;
}

/**
 * Force clear plan mode state (for testing or manual reset)
 *
 * @param options - Configuration options
 * @returns True if clear succeeded
 */
export function resetPlanMode(options: IPlanModeOptions = {}): boolean {
  const { devDir = DEFAULT_DEV_DIR } = options;
  return clearPlanModeState(devDir);
}

/**
 * Get the age of the current plan mode state in milliseconds
 *
 * @param options - Configuration options
 * @returns Age in milliseconds, or null if no state
 */
export function getPlanModeAge(options: IPlanModeOptions = {}): number | null {
  const { devDir = DEFAULT_DEV_DIR } = options;
  const state = readPlanModeState(devDir);

  if (!state) {
    return null;
  }

  try {
    return Date.now() - new Date(state.loadedAt).getTime();
  } catch {
    return null;
  }
}
