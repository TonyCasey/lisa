/**
 * Session Start Request.
 *
 * Request to load memory context at the start of a session.
 */

import type { IRequest } from '../IMediator';
import type { ISessionStartResult } from '../../interfaces';
import type { SessionTrigger, ISOTimestamp } from '../../../domain';

/**
 * Request to start a session and load memory context.
 */
export class SessionStartRequest implements IRequest<ISessionStartResult> {
  readonly __responseType?: ISessionStartResult;

  constructor(
    /** What triggered the session start */
    public readonly trigger: SessionTrigger,
    /** When the session started */
    public readonly timestamp: ISOTimestamp,
    /** Optional session identifier */
    public readonly sessionId?: string
  ) {}

  /**
   * Create from a session start event.
   */
  static fromEvent(event: {
    trigger: SessionTrigger;
    timestamp: ISOTimestamp;
    sessionId?: string;
  }): SessionStartRequest {
    return new SessionStartRequest(event.trigger, event.timestamp, event.sessionId);
  }
}
