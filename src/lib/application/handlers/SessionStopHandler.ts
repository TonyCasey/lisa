import type { ISessionStopEvent, ILisaServices } from '../../domain';
import { toISOTimestamp } from '../../domain';

/**
 * Handler for session stop events.
 * Captures session work and saves to memory.
 */
export class SessionStopHandler {
  constructor(private readonly services: ILisaServices) {}

  /**
   * Handle a session stop event.
   * Captures work from the session and saves to memory.
   */
  async handle(event: ISessionStopEvent): Promise<void> {
    const { context, memory, sessionCapture, events } = this.services;

    // Delegate fact capture to dedicated service
    const captured = await sessionCapture.captureSessionWork(event.sessionId);

    if (captured.facts.length > 0) {
      // Save captured facts to memory
      await memory.saveMemory(context.groupId, captured.facts);
    }

    // Emit internal event for any listeners
    await events.emit({
      type: 'memory:save',
      facts: captured.facts,
      groupId: context.groupId,
      timestamp: toISOTimestamp(),
    });
  }
}
