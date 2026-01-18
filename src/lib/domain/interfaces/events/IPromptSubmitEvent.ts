import type { ISOTimestamp } from '../../types';

/**
 * Permission mode from Claude Code hook input.
 */
export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';

/**
 * Event emitted when a user submits a prompt.
 */
export interface IPromptSubmitEvent {
  readonly type: 'prompt:submit';
  readonly content: string;
  readonly timestamp: ISOTimestamp;
  readonly sessionId?: string;
  readonly permissionMode?: PermissionMode;
}

/**
 * Create a prompt submit event.
 */
export function createPromptSubmitEvent(
  content: string,
  timestamp: ISOTimestamp,
  sessionId?: string,
  permissionMode?: PermissionMode
): IPromptSubmitEvent {
  return {
    type: 'prompt:submit',
    content,
    timestamp,
    sessionId,
    permissionMode,
  };
}
