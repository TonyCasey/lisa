import type {
  ILisaServices,
  ILisaContext,
  IMemoryService,
  ISessionCaptureService,
  IEventEmitter,
  ILogger,
} from '../../domain';
import { toISOTimestamp } from '../../domain';
import type { IRequestHandler } from '../mediator';
import { SessionStopRequest } from '../mediator/requests';
import type { ISessionStopResult } from '../mediator/requests';

/**
 * Handler for session stop events.
 * Captures session work and saves to memory.
 *
 * Implements IRequestHandler for use with the Mediator pattern.
 */
export class SessionStopHandler implements IRequestHandler<SessionStopRequest, ISessionStopResult> {
  private readonly context: ILisaContext;
  private readonly memory: IMemoryService;
  private readonly sessionCapture: ISessionCaptureService;
  private readonly events: IEventEmitter;
  private readonly logger?: ILogger;

  /**
   * Create a new SessionStopHandler.
   *
   * @param services - Lisa services (legacy constructor for backward compatibility)
   */
  constructor(services: ILisaServices);

  /**
   * Create a new SessionStopHandler with individual service injection.
   */
  constructor(
    context: ILisaContext,
    memory: IMemoryService,
    sessionCapture: ISessionCaptureService,
    events: IEventEmitter,
    logger?: ILogger
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    sessionCapture?: ISessionCaptureService,
    events?: IEventEmitter,
    logger?: ILogger
  ) {
    if ('context' in contextOrServices && 'memory' in contextOrServices) {
      const services = contextOrServices as ILisaServices;
      this.context = services.context;
      this.memory = services.memory;
      this.sessionCapture = services.sessionCapture;
      this.events = services.events;
      this.logger = services.logger;
    } else {
      this.context = contextOrServices as ILisaContext;
      this.memory = memory!;
      this.sessionCapture = sessionCapture!;
      this.events = events!;
      this.logger = logger;
    }
  }

  /**
   * Handle a session stop request.
   * Captures work from the session and saves to memory.
   */
  async handle(request: SessionStopRequest): Promise<ISessionStopResult> {
    // Delegate fact capture to dedicated service
    const captured = await this.sessionCapture.captureSessionWork(
      request.sessionId,
      request.transcriptPath
    );

    if (captured.facts.length === 0) {
      return {
        message: 'No significant work to capture.',
        factsCaptured: 0,
        skipped: true,
        skipReason: 'No facts captured from session',
      };
    }

    // Save captured facts to memory
    await this.memory.saveMemory(this.context.groupId, captured.facts);

    // Emit internal event for any listeners
    await this.events.emit({
      type: 'memory:save',
      facts: captured.facts,
      groupId: this.context.groupId,
      timestamp: toISOTimestamp(),
    });

    return {
      message: `Captured ${captured.facts.length} fact(s) from session.`,
      factsCaptured: captured.facts.length,
      skipped: false,
    };
  }
}
