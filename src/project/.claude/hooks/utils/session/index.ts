/**
 * Session module exports
 *
 * Re-exports all session-related functions for clean imports.
 */

export {
  // Trigger messages
  getTriggerMessage,
  getTriggerReminders,
  // Labels
  getTriggerLabel,
  formatTriggerLabel,
  // Validation
  VALID_TRIGGERS,
  isValidTrigger,
  parseTrigger,
  // Context checks
  isContextResetTrigger,
  isFreshStartTrigger,
  isResumeTrigger,
} from './trigger-handler';

// Plan mode
export type { IPlanModeState, IPlanModeOptions } from './plan-mode';
export {
  // Configuration
  PLAN_MODE_TTL_MS,
  DEFAULT_DEV_DIR,
  PLAN_MODE_STATE_FILE,
  // Path helpers
  getPlanModeStatePath,
  // State management
  readPlanModeState,
  writePlanModeState,
  clearPlanModeState,
  isPlanModeStateExpired,
  // Main functions
  shouldLoadPlanContext,
  resetPlanMode,
  getPlanModeAge,
} from './plan-mode';
