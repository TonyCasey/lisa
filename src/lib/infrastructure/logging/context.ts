import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

/**
 * Log context stored in AsyncLocalStorage.
 * Includes correlation ID and any additional context.
 */
export interface ILogContext {
  /** Unique ID for tracing operations across async boundaries */
  correlationId: string;
  /** Additional context data */
  [key: string]: unknown;
}

/**
 * AsyncLocalStorage instance for log context.
 * This allows us to automatically include correlation IDs
 * in all log entries within an async operation.
 */
const contextStore = new AsyncLocalStorage<ILogContext>();

/**
 * Generate a new correlation ID.
 * Uses crypto.randomUUID() for uniqueness.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Run a function with a correlation context.
 * All log entries within the function will include the correlation ID.
 * 
 * @param fn - Function to run with correlation context
 * @param existingContext - Optional existing context to extend
 * @returns The result of the function
 * 
 * @example
 * ```typescript
 * await withCorrelation(async () => {
 *   logger.info('Starting operation'); // includes correlationId
 *   await someAsyncOperation();
 *   logger.info('Completed'); // same correlationId
 * });
 * ```
 */
export function withCorrelation<T>(
  fn: () => T | Promise<T>,
  existingContext?: Partial<ILogContext>
): T | Promise<T> {
  const correlationId = existingContext?.correlationId ?? generateCorrelationId();
  const context: ILogContext = {
    ...existingContext,
    correlationId,
  };
  return contextStore.run(context, fn);
}

/**
 * Get the current correlation ID from the async context.
 * Returns undefined if not within a correlation context.
 */
export function getCorrelationId(): string | undefined {
  return contextStore.getStore()?.correlationId;
}

/**
 * Get the full log context from the async context.
 * Returns undefined if not within a correlation context.
 */
export function getLogContext(): ILogContext | undefined {
  return contextStore.getStore();
}

/**
 * Add additional context to the current log context.
 * Only works if already within a withCorrelation() call.
 * 
 * @param additionalContext - Context to add
 */
export function extendLogContext(additionalContext: Record<string, unknown>): void {
  const current = contextStore.getStore();
  if (current) {
    Object.assign(current, additionalContext);
  }
}
