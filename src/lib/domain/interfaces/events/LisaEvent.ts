import type { ISessionStartEvent } from './ISessionStartEvent';
import type { ISessionStopEvent } from './ISessionStopEvent';
import type { IPromptSubmitEvent } from './IPromptSubmitEvent';
import type { IMemoryLoadEvent, IMemorySaveEvent } from './IMemoryEvent';

/**
 * Union type of all Lisa events.
 */
export type LisaEvent =
  | ISessionStartEvent
  | ISessionStopEvent
  | IPromptSubmitEvent
  | IMemoryLoadEvent
  | IMemorySaveEvent;

/**
 * Extract event type string from LisaEvent.
 */
export type LisaEventType = LisaEvent['type'];
