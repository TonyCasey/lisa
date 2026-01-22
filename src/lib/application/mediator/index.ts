/**
 * Mediator Pattern Implementation.
 *
 * Provides a single entry point for all request/response operations.
 */

// Interfaces
export type { IRequest, IRequestHandler, IRequestType, IMediator } from './IMediator';

// Implementation
export { Mediator, createMediator } from './Mediator';

// Request types
export {
  SessionStartRequest,
  SessionStopRequest,
  PromptSubmitRequest,
} from './requests';
export type { ISessionStopResult, IPromptSubmitResult } from './requests';
