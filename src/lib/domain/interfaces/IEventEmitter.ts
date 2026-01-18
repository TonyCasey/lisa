import type { LisaEvent, LisaEventType } from './events';

/**
 * Event handler function type.
 */
export type EventHandler<T extends LisaEvent> = (event: T) => Promise<void>;

/**
 * Event emitter interface for Lisa events.
 */
export interface IEventEmitter {
  /**
   * Emit an event to all registered handlers.
   * @param event - Event to emit
   */
  emit(event: LisaEvent): Promise<void>;

  /**
   * Register a handler for a specific event type.
   * @param type - Event type to listen for
   * @param handler - Handler function
   */
  on<T extends LisaEventType>(
    type: T,
    handler: EventHandler<Extract<LisaEvent, { type: T }>>
  ): void;

  /**
   * Remove a handler for a specific event type.
   * @param type - Event type
   * @param handler - Handler to remove
   */
  off<T extends LisaEventType>(
    type: T,
    handler: EventHandler<Extract<LisaEvent, { type: T }>>
  ): void;
}
