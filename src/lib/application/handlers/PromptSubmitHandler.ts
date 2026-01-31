import type {
  ILisaServices,
  ILisaContext,
  IMemoryService,
  IRecursionService,
  IRecursionResult,
  ILogger,
  ITaskTypeDetector,
  TaskType,
} from '../../domain';
import type { IRequestHandler } from '../mediator';
import { PromptSubmitRequest } from '../mediator/requests';
import type { IPromptSubmitResult } from '../mediator/requests';

/**
 * Handler for prompt submit events.
 * Records user prompts to memory and runs mode-aware recursion.
 *
 * Implements IRequestHandler for use with the Mediator pattern.
 */
export class PromptSubmitHandler implements IRequestHandler<PromptSubmitRequest, IPromptSubmitResult> {
  private readonly context: ILisaContext;
  private readonly memory: IMemoryService;
  private readonly recursion?: IRecursionService;
  private readonly logger?: ILogger;
  private readonly taskTypeDetector?: ITaskTypeDetector;

  /**
   * Create a new PromptSubmitHandler.
   *
   * @param services - Lisa services (legacy constructor for backward compatibility)
   */
  constructor(services: ILisaServices);

  /**
   * Create a new PromptSubmitHandler with individual service injection.
   */
  constructor(
    context: ILisaContext,
    memory: IMemoryService,
    recursion?: IRecursionService,
    logger?: ILogger,
    taskTypeDetector?: ITaskTypeDetector
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    recursion?: IRecursionService,
    logger?: ILogger,
    taskTypeDetector?: ITaskTypeDetector
  ) {
    if ('context' in contextOrServices && 'memory' in contextOrServices) {
      const services = contextOrServices as ILisaServices;
      this.context = services.context;
      this.memory = services.memory;
      this.recursion = services.recursion;
      this.logger = services.logger;
      this.taskTypeDetector = (services as { taskTypeDetector?: ITaskTypeDetector }).taskTypeDetector;
    } else {
      this.context = contextOrServices as ILisaContext;
      this.memory = memory!;
      this.recursion = recursion;
      this.logger = logger;
      this.taskTypeDetector = taskTypeDetector;
    }
  }

  /**
   * Handle a prompt submit request.
   * - Auto-detects task type from prompt
   * - Runs memory recursion for plan/debugging/exploration modes
   * - Adds the prompt to memory for context
   */
  async handle(request: PromptSubmitRequest): Promise<IPromptSubmitResult> {
    let planModeRecursion = false;
    let additionalContext: string | undefined;
    let recursionResult: IRecursionResult | undefined;
    let detectedTaskType: TaskType | undefined;

    // Auto-detect task type
    if (this.taskTypeDetector) {
      try {
        const detection = this.taskTypeDetector.detect(request.content);
        detectedTaskType = detection.taskType;
      } catch {
        // Silently ignore detection errors
      }
    }

    // Run memory recursion (plan mode, debugging, or exploration)
    if (this.recursion) {
      const permissionMode = request.permissionMode ?? 'default';
      if (this.recursion.shouldRun(request.content, permissionMode, detectedTaskType)) {
        try {
          recursionResult = await this.recursion.run(
            request.content,
            this.context.hierarchicalGroupIds,
            detectedTaskType
          );
          if (recursionResult.hasContext) {
            planModeRecursion = true;
            additionalContext = recursionResult.summary;
          }
        } catch {
          // Silently ignore recursion errors
        }
      }
    }

    // Truncate long prompts
    const truncatedContent = this.truncate(request.content, 200);

    // Add to memory with ephemeral lifecycle (fire-and-forget style)
    try {
      await this.memory.addFactWithLifecycle(
        this.context.groupId,
        `User prompt at ${request.timestamp}: ${truncatedContent}`,
        { lifecycle: 'ephemeral', tags: ['type:prompt'] }
      );
    } catch {
      // Silently ignore errors - don't block user experience
    }

    return {
      content: request.content,
      blocked: false,
      planModeRecursion,
      additionalContext,
      taskType: detectedTaskType,
      // Deprecated: include for backward compatibility
      recursion: recursionResult,
    };
  }

  /**
   * Truncate a string to a maximum length.
   */
  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }
}
