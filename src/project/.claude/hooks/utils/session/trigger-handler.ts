/**
 * Trigger Handler - Handle different session start trigger types
 *
 * Pure functions for generating trigger-specific messages and reminders.
 * These are used by the session-start hook to provide context-appropriate
 * messaging to the user.
 */

import type { SessionTrigger } from '../core/types';

// =============================================================================
// Trigger Messages
// =============================================================================

/**
 * Get the main message for a session trigger type
 *
 * @param trigger - The type of session start trigger
 * @returns A message describing what happened
 */
export function getTriggerMessage(trigger: SessionTrigger): string {
  switch (trigger) {
    case 'startup':
      return 'Memory loaded for session start.';
    case 'resume':
      return 'Memory loaded for session resume.';
    case 'compact':
      return 'Memory reloaded after context compaction.';
    case 'clear':
      return 'Memory loaded after context clear.';
    default:
      return 'Memory loaded for session start.';
  }
}

/**
 * Get trigger-specific reminders (shown after compact/clear)
 *
 * These reminders help the user understand context limitations
 * after certain session events.
 *
 * @param trigger - The type of session start trigger
 * @returns Array of reminder messages (may be empty)
 */
export function getTriggerReminders(trigger: SessionTrigger): string[] {
  const reminders: string[] = [];

  if (trigger === 'compact') {
    reminders.push(
      'Note: Context was compacted. Previously loaded skills may need to be re-invoked if needed.'
    );
  }

  if (trigger === 'clear') {
    reminders.push(
      'Note: Context was cleared. Start fresh or use /memory to recall prior work.'
    );
  }

  return reminders;
}

// =============================================================================
// Trigger Labels
// =============================================================================

/**
 * Get a short label for the trigger type (for status messages)
 *
 * @param trigger - The type of session start trigger
 * @returns Short label or empty string for startup
 */
export function getTriggerLabel(trigger: SessionTrigger): string {
  if (trigger === 'startup') {
    return '';
  }
  return trigger;
}

/**
 * Format a trigger label for display (with parentheses if non-empty)
 *
 * @param trigger - The type of session start trigger
 * @returns Formatted label like " (resume)" or empty string
 */
export function formatTriggerLabel(trigger: SessionTrigger): string {
  const label = getTriggerLabel(trigger);
  return label ? ` (${label})` : '';
}

// =============================================================================
// Trigger Validation
// =============================================================================

/**
 * Valid trigger types
 */
export const VALID_TRIGGERS: readonly SessionTrigger[] = [
  'startup',
  'resume',
  'compact',
  'clear',
] as const;

/**
 * Check if a string is a valid trigger type
 *
 * @param value - The value to check
 * @returns True if valid trigger type
 */
export function isValidTrigger(value: string | undefined): value is SessionTrigger {
  return VALID_TRIGGERS.includes(value as SessionTrigger);
}

/**
 * Parse trigger from hook input, with fallback to 'startup'
 *
 * @param trigger - The trigger value from input
 * @param sessionType - Alternative trigger value (session_type)
 * @returns Valid trigger type
 */
export function parseTrigger(
  trigger?: string,
  sessionType?: string
): SessionTrigger {
  const value = trigger || sessionType;
  return isValidTrigger(value) ? value : 'startup';
}

// =============================================================================
// Trigger Context
// =============================================================================

/**
 * Check if this trigger indicates a context reset
 * (user should be informed about potential missing context)
 */
export function isContextResetTrigger(trigger: SessionTrigger): boolean {
  return trigger === 'compact' || trigger === 'clear';
}

/**
 * Check if this trigger is a fresh start
 */
export function isFreshStartTrigger(trigger: SessionTrigger): boolean {
  return trigger === 'startup' || trigger === 'clear';
}

/**
 * Check if this trigger is resuming existing work
 */
export function isResumeTrigger(trigger: SessionTrigger): boolean {
  return trigger === 'resume' || trigger === 'compact';
}
