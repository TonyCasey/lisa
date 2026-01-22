/**
 * Application layer interfaces.
 */

export { ISessionStartResult } from './ISessionStartResult';

// Re-export result interfaces from mediator requests
export type { ISessionStopResult, IPromptSubmitResult } from '../mediator/requests';
