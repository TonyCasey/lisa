/**
 * Types for Claude Code hook handlers.
 * These match the Claude Code hook protocol for stdin/stdout communication.
 */

/**
 * Input received from Claude Code for SessionStart hook.
 */
export interface ISessionStartHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  /** Trigger type: startup, resume, compact, clear */
  source?: 'startup' | 'resume' | 'compact' | 'clear';
  /** Legacy field for trigger */
  trigger?: string;
  session_type?: string;
}

/**
 * Input received from Claude Code for Stop hook.
 */
export interface ISessionStopHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  /** True if a stop hook is already active (prevent loops) */
  stop_hook_active?: boolean;
}

/**
 * Input received from Claude Code for UserPromptSubmit hook.
 */
export interface IUserPromptSubmitHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  /** The user's prompt text */
  prompt?: string;
  /** Alternative field for permission mode */
  permissionMode?: string;
}

/**
 * Output format for SessionStart hook.
 * Returns context to inject into Claude's context.
 */
export interface ISessionStartHookOutput {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext?: string;
  };
  continue?: boolean;
  stopReason?: string;
}

/**
 * Output format for Stop hook.
 */
export interface ISessionStopHookOutput {
  continue?: boolean;
  stopReason?: string;
  decision?: 'block' | undefined;
  reason?: string;
}

/**
 * Output format for UserPromptSubmit hook.
 */
export interface IUserPromptSubmitHookOutput {
  decision?: 'block' | undefined;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: 'UserPromptSubmit';
    additionalContext?: string;
  };
}

/**
 * Session trigger types.
 */
export type SessionTrigger = 'startup' | 'resume' | 'compact' | 'clear';

/**
 * Parse trigger from hook input.
 */
export function parseTrigger(source?: string, sessionType?: string): SessionTrigger {
  if (source === 'startup' || source === 'resume' || source === 'compact' || source === 'clear') {
    return source;
  }
  if (sessionType === 'resume') {
    return 'resume';
  }
  return 'startup';
}
