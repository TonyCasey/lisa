import type { IEventEmitter, EventHandler, LisaEvent, LisaEventType } from '../../domain';

/**
 * Simple event emitter implementation for Lisa events.
 */
export class EventEmitter implements IEventEmitter {
  private handlers: Map<LisaEventType, Set<EventHandler<LisaEvent>>> = new Map();

  /**
   * Emit an event to all registered handlers.
   */
  async emit(event: LisaEvent): Promise<void> {
    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers) return;

    const promises = Array.from(eventHandlers).map((handler) => handler(event));
    await Promise.all(promises);
  }

  /**
   * Register a handler for a specific event type.
   */
  on<T extends LisaEventType>(
    type: T,
    handler: EventHandler<Extract<LisaEvent, { type: T }>>
  ): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler<LisaEvent>);
  }

  /**
   * Remove a handler for a specific event type.
   */
  off<T extends LisaEventType>(
    type: T,
    handler: EventHandler<Extract<LisaEvent, { type: T }>>
  ): void {
    const eventHandlers = this.handlers.get(type);
    if (eventHandlers) {
      eventHandlers.delete(handler as EventHandler<LisaEvent>);
    }
  }
}
