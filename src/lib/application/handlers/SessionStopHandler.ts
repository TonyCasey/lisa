import type {
  ILisaServices,
  ILisaContext,
  IMemoryService,
  ISessionCaptureService,
  IEventEmitter,
  ILogger,
  ITaskService,
} from '../../domain';
import { toISOTimestamp } from '../../domain';
import type { IRequestHandler } from '../mediator';
import { SessionStopRequest } from '../mediator/requests';
import type { ISessionStopResult, ISessionStopSuggestion } from '../mediator/requests';

/**
 * Handler for session stop events.
 * Captures session work and saves to memory.
 *
 * Implements IRequestHandler for use with the Mediator pattern.
 */
export class SessionStopHandler implements IRequestHandler<SessionStopRequest, ISessionStopResult> {
  private readonly context: ILisaContext;
  private readonly memory: IMemoryService;
  private readonly tasks?: ITaskService;
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
    logger?: ILogger,
    tasks?: ITaskService
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    sessionCapture?: ISessionCaptureService,
    events?: IEventEmitter,
    logger?: ILogger,
    tasks?: ITaskService
  ) {
    if ('context' in contextOrServices && 'memory' in contextOrServices) {
      const services = contextOrServices as ILisaServices;
      this.context = services.context;
      this.memory = services.memory;
      this.tasks = services.tasks;
      this.sessionCapture = services.sessionCapture;
      this.events = services.events;
      this.logger = services.logger;
    } else {
      this.context = contextOrServices as ILisaContext;
      this.memory = memory!;
      this.sessionCapture = sessionCapture!;
      this.events = events!;
      this.logger = logger;
      this.tasks = tasks;
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

    // Generate suggestions based on current state
    const suggestions = await this.generateSuggestions();

    if (captured.facts.length === 0) {
      return {
        message: 'No significant work to capture.',
        factsCaptured: 0,
        skipped: true,
        skipReason: 'No facts captured from session',
        suggestions: suggestions.length > 0 ? suggestions : undefined,
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
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Generate suggestions based on current tasks and state.
   * Suggests actions like syncing unlinked tasks to GitHub.
   */
  private async generateSuggestions(): Promise<ISessionStopSuggestion[]> {
    const suggestions: ISessionStopSuggestion[] = [];

    if (!this.tasks) {
      return suggestions;
    }

    try {
      // Get current tasks
      const tasks = await this.tasks.getTasksSimple([this.context.groupId]);

      // Count incomplete tasks without external links
      const unlinkedIncompleteTasks = tasks.filter(
        (t) => t.status !== 'done' && t.status !== 'closed' && !t.externalLink
      );

      if (unlinkedIncompleteTasks.length > 0) {
        suggestions.push({
          action: 'sync-github-export',
          message: `${unlinkedIncompleteTasks.length} incomplete task(s) could be tracked as GitHub issues`,
          command: 'lisa github sync --export',
          count: unlinkedIncompleteTasks.length,
        });
      }

      // Count tasks with external links that might need sync
      const linkedTasks = tasks.filter((t) => t.externalLink?.source === 'github');
      if (linkedTasks.length > 0) {
        // Suggest sync to keep status in sync
        suggestions.push({
          action: 'sync-github-bidirectional',
          message: `${linkedTasks.length} task(s) linked to GitHub - sync to update status`,
          command: 'lisa github sync',
          count: linkedTasks.length,
        });
      }
    } catch (error) {
      // Don't fail session stop if suggestions fail
      this.logger?.debug?.('Failed to generate suggestions', { error });
    }

    return suggestions;
  }
}
