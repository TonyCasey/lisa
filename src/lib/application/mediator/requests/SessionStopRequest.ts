/**
 * Session Stop Request.
 *
 * Request to capture work at the end of a session.
 */

import type { IRequest } from '../IMediator';
import type { SessionStopReason, ISOTimestamp } from '../../../domain';

/**
 * A suggested action for the user.
 */
export interface ISessionStopSuggestion {
  /** Action identifier */
  readonly action: string;
  /** Human-readable description */
  readonly message: string;
  /** CLI command to execute the action */
  readonly command: string;
  /** Number of items this suggestion applies to */
  readonly count?: number;
}

/**
 * Result from handling a session stop request.
 */
export interface ISessionStopResult {
  /** Human-readable message about what was captured */
  readonly message: string;

  /** Number of facts captured */
  readonly factsCaptured: number;

  /** Whether capture was skipped (e.g., no significant work) */
  readonly skipped: boolean;

  /** Reason for skipping, if applicable */
  readonly skipReason?: string;

  /** Suggested follow-up actions for the user */
  readonly suggestions?: readonly ISessionStopSuggestion[];
}

/**
 * Request to stop a session and capture work.
 */
export class SessionStopRequest implements IRequest<ISessionStopResult> {
  readonly __responseType?: ISessionStopResult;

  constructor(
    /** Why the session stopped */
    public readonly reason: SessionStopReason,
    /** When the session stopped */
    public readonly timestamp: ISOTimestamp,
    /** Optional session identifier */
    public readonly sessionId?: string,
    /** Optional transcript path for parsing */
    public readonly transcriptPath?: string
  ) {}

  /**
   * Create from a session stop event.
   */
  static fromEvent(
    event: {
      reason: SessionStopReason;
      timestamp: ISOTimestamp;
      sessionId?: string;
    },
    transcriptPath?: string
  ): SessionStopRequest {
    return new SessionStopRequest(
      event.reason,
      event.timestamp,
      event.sessionId,
      transcriptPath
    );
  }
}
