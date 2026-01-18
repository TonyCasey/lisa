import type { IPromptSubmitEvent, ILisaServices, IRecursionResult } from '../../domain';

/**
 * Result from handling a prompt submit event.
 */
export interface IPromptSubmitResult {
  /** Recursion result if in plan mode */
  readonly recursion?: IRecursionResult;
}

/**
 * Handler for prompt submit events.
 * Records user prompts to memory and runs recursion in plan mode.
 */
export class PromptSubmitHandler {
  constructor(private readonly services: ILisaServices) {}

  /**
   * Handle a prompt submit event.
   * - Adds the prompt to memory for context
   * - Runs memory recursion if in plan mode
   */
  async handle(event: IPromptSubmitEvent): Promise<IPromptSubmitResult> {
    const { context, memory, recursion } = this.services;
    const result: IPromptSubmitResult = {};

    // Run memory recursion in plan mode
    if (recursion && event.permissionMode === 'plan') {
      if (recursion.shouldRun(event.content, event.permissionMode)) {
        try {
          const recursionResult = await recursion.run(
            event.content,
            context.hierarchicalGroupIds
          );
          if (recursionResult.hasContext) {
            (result as { recursion: IRecursionResult }).recursion = recursionResult;
          }
        } catch {
          // Silently ignore recursion errors
        }
      }
    }

    // Truncate long prompts
    const truncatedContent = this.truncate(event.content, 200);

    // Add to memory (fire-and-forget style - don't block on errors)
    try {
      await memory.addFact(
        context.groupId,
        `User prompt at ${event.timestamp}: ${truncatedContent}`,
        ['type:prompt']
      );
    } catch {
      // Silently ignore errors - don't block user experience
    }

    return result;
  }

  /**
   * Truncate a string to a maximum length.
   */
  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }
}
