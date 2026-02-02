import type {
  ILisaServices,
  ILisaContext,
  IMemoryService,
  IRecursionService,
  IRecursionResult,
  ILogger,
  ITaskTypeDetector,
  IProactiveDetector,
} from '../../domain';
import type { IRequestHandler } from '../mediator';
import { PromptSubmitRequest } from '../mediator/requests';
import type { IPromptSubmitResult } from '../mediator/requests';

/**
 * User confirmation patterns for decision flagging.
 */
const DECISION_CONFIRMATION_PATTERN = /^(yes|ok|sounds good|let'?s go with|do that|go ahead|approved?|agreed?)\b/i;

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
  private readonly taskTypeDetector?: ITaskTypeDetector;
  private readonly proactiveDetector?: IProactiveDetector;

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
    taskTypeDetector?: ITaskTypeDetector,
    proactiveDetector?: IProactiveDetector
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    recursion?: IRecursionService,
    logger?: ILogger,
    taskTypeDetector?: ITaskTypeDetector,
    proactiveDetector?: IProactiveDetector
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
      this.taskTypeDetector = taskTypeDetector;
      this.proactiveDetector = proactiveDetector;
    }
  }

  /**
   * Handle a prompt submit request.
   * - Detects task type from prompt
   * - Adds the prompt to memory with task type and decision tags
   * - Runs memory recursion if in plan mode (with detected task type)
   */
  async handle(request: PromptSubmitRequest): Promise<IPromptSubmitResult> {
    let planModeRecursion = false;
    let additionalContext: string | undefined;
    let recursionResult: IRecursionResult | undefined;

    // Detect task type from prompt
    const detection = this.taskTypeDetector?.detect(request.content);

    // Run memory recursion in plan mode
    if (this.recursion && request.permissionMode === 'plan') {
      if (this.recursion.shouldRun(request.content, request.permissionMode)) {
        try {
          recursionResult = await this.recursion.run(
            request.content,
            this.context.hierarchicalGroupIds,
            detection?.taskType
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

    // Proactive detection: suggest saving decisions/milestones
    if (this.proactiveDetector) {
      const detection = this.proactiveDetector.detect(
        request.content,
        request.previousAssistantMessage
      );
      if (detection.shouldSuggest && detection.suggestedFact) {
        const suggestion = `[Memory suggestion: This looks like a ${detection.factType || 'notable event'}. Consider saving: "${detection.suggestedFact}". Use /memory to save.]`;
        additionalContext = additionalContext
          ? `${additionalContext}\n\n${suggestion}`
          : suggestion;
      }
    }

    // Truncate long prompts
    const truncatedContent = this.truncate(request.content, 200);

    // Build tags with task type and decision flag
    const tags: string[] = ['type:prompt'];
    if (detection) {
      tags.push(`taskType:${detection.taskType}`);
    }
    if (DECISION_CONFIRMATION_PATTERN.test(request.content.trim())) {
      tags.push('flag:decision');
    }

    // Add to memory with ephemeral lifecycle (fire-and-forget style)
    try {
      await this.memory.addFactWithLifecycle(
        this.context.groupId,
        `User prompt at ${request.timestamp}: ${truncatedContent}`,
        { lifecycle: 'ephemeral', tags }
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
