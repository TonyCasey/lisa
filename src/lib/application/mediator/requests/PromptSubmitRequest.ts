/**
 * Prompt Submit Request.
 *
 * Request to process a user-submitted prompt.
 */

import type { IRequest } from '../IMediator';
import type { PermissionMode, ISOTimestamp, IRecursionResult } from '../../../domain';

/**
 * Result from handling a prompt submit request.
 */
export interface IPromptSubmitResult {
  /** The processed prompt content (may be enhanced) */
  readonly content: string;

  /** Whether the prompt should be blocked */
  readonly blocked: boolean;

  /** Reason for blocking, if applicable */
  readonly blockReason?: string;

  /** Whether plan mode recursion was detected */
  readonly planModeRecursion: boolean;

  /** Additional context to inject */
  readonly additionalContext?: string;

  /**
   * Recursion result if in plan mode.
   * @deprecated Use planModeRecursion and additionalContext instead
   */
  readonly recursion?: IRecursionResult;
}

/**
 * Request to process a user-submitted prompt.
 */
export class PromptSubmitRequest implements IRequest<IPromptSubmitResult> {
  readonly __responseType?: IPromptSubmitResult;

  constructor(
    /** The prompt content */
    public readonly content: string,
    /** When the prompt was submitted */
    public readonly timestamp: ISOTimestamp,
    /** Optional session identifier */
    public readonly sessionId?: string,
    /** Current permission mode */
    public readonly permissionMode?: PermissionMode,
    /** Previous assistant message (for proactive detection) */
    public readonly previousAssistantMessage?: string
  ) {}

  /**
   * Create from a prompt submit event.
   */
  static fromEvent(event: {
    content: string;
    timestamp: ISOTimestamp;
    sessionId?: string;
    permissionMode?: PermissionMode;
    previousAssistantMessage?: string;
  }): PromptSubmitRequest {
    return new PromptSubmitRequest(
      event.content,
      event.timestamp,
      event.sessionId,
      event.permissionMode,
      event.previousAssistantMessage
    );
  }
}
