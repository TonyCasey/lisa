import type {
  ILisaServices,
  ILisaContext,
  IMemoryService,
  IRecursionService,
  IRecursionResult,
  ILogger,
} from '../../domain';
import type { IRequestHandler } from '../mediator';
import { PromptSubmitRequest } from '../mediator/requests';
import type { IPromptSubmitResult } from '../mediator/requests';

/**
 * Handler for prompt submit events.
 * Records user prompts to memory and runs recursion in plan mode.
 *
 * Implements IRequestHandler for use with the Mediator pattern.
 */
export class PromptSubmitHandler implements IRequestHandler<PromptSubmitRequest, IPromptSubmitResult> {
  private readonly context: ILisaContext;
  private readonly memory: IMemoryService;
  private readonly recursion?: IRecursionService;
  private readonly logger?: ILogger;

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
    logger?: ILogger
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    recursion?: IRecursionService,
    logger?: ILogger
  ) {
    if ('context' in contextOrServices && 'memory' in contextOrServices) {
      const services = contextOrServices as ILisaServices;
      this.context = services.context;
      this.memory = services.memory;
      this.recursion = services.recursion;
      this.logger = services.logger;
    } else {
      this.context = contextOrServices as ILisaContext;
      this.memory = memory!;
      this.recursion = recursion;
      this.logger = logger;
    }
  }

  /**
   * Handle a prompt submit request.
   * - Adds the prompt to memory for context
   * - Runs memory recursion if in plan mode
   */
  async handle(request: PromptSubmitRequest): Promise<IPromptSubmitResult> {
    let planModeRecursion = false;
    let additionalContext: string | undefined;
    let recursionResult: IRecursionResult | undefined;

    // Run memory recursion in plan mode
    if (this.recursion && request.permissionMode === 'plan') {
      if (this.recursion.shouldRun(request.content, request.permissionMode)) {
        try {
          recursionResult = await this.recursion.run(
            request.content,
            this.context.hierarchicalGroupIds
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

    // Add to memory (fire-and-forget style - don't block on errors)
    try {
      await this.memory.addFact(
        this.context.groupId,
        `User prompt at ${request.timestamp}: ${truncatedContent}`,
        ['type:prompt']
      );
    } catch {
      // Silently ignore errors - don't block user experience
    }

    return {
      content: request.content,
      blocked: false,
      planModeRecursion,
      additionalContext,
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
