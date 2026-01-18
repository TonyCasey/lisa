import type { ISOTimestamp } from '../../types';

/**
 * Reason for session stop.
 */
export type SessionStopReason = 'idle' | 'user' | 'error';

/**
 * Event emitted when a session stops.
 * 
 * Note: capturedFacts are NOT part of the event.
 * The handler invokes ISessionCaptureService to gather facts.
 */
export interface ISessionStopEvent {
  readonly type: 'session:stop';
  readonly reason: SessionStopReason;
  readonly timestamp: ISOTimestamp;
  readonly sessionId?: string;
}

/**
 * Create a session stop event.
 */
export function createSessionStopEvent(
  reason: SessionStopReason,
  timestamp: ISOTimestamp,
  sessionId?: string
): ISessionStopEvent {
  return {
    type: 'session:stop',
    reason,
    timestamp,
    sessionId,
  };
}
