import type { ISOTimestamp } from '../../types';

/**
 * Session start trigger types.
 */
export type SessionTrigger = 'startup' | 'resume' | 'compact' | 'clear';

/**
 * Event emitted when a session starts.
 */
export interface ISessionStartEvent {
  readonly type: 'session:start';
  readonly trigger: SessionTrigger;
  readonly timestamp: ISOTimestamp;
  readonly sessionId?: string;
}

/**
 * Create a session start event.
 */
export function createSessionStartEvent(
  trigger: SessionTrigger,
  timestamp: ISOTimestamp,
  sessionId?: string
): ISessionStartEvent {
  return {
    type: 'session:start',
    trigger,
    timestamp,
    sessionId,
  };
}
