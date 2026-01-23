/**
 * Cancellation utilities for async operations.
 *
 * Provides AbortController-based cancellation for async workflows,
 * ensuring no mutations occur after timeout and resources are cleaned up.
 *
 * These utilities are in the domain layer as they represent domain-agnostic
 * patterns that can be used by both application and infrastructure layers.
 */

/**
 * Error thrown when an operation is cancelled.
 */
export class CancellationError extends Error {
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Check if an error is a CancellationError.
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}

/**
 * Options for cancellable operations.
 */
export interface CancellableOptions {
  /** Timeout in milliseconds. If not provided, no timeout is set. */
  timeoutMs?: number;
  /** External abort signal to combine with internal timeout. */
  signal?: AbortSignal;
  /** Callback when cancellation occurs (for cleanup). */
  onCancel?: () => void;
}

/**
 * Result of a cancellable operation.
 */
export interface CancellableResult<T> {
  /** The result value, if operation completed successfully. */
  value?: T;
  /** Whether the operation was cancelled (timeout or external signal). */
  cancelled: boolean;
  /** Whether the operation timed out specifically. */
  timedOut: boolean;
  /** Error if operation failed (not due to cancellation). */
  error?: Error;
}

/**
 * Combine multiple AbortSignals into one.
 * The combined signal aborts when any of the input signals abort.
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }

    signal.addEventListener(
      'abort',
      () => controller.abort(),
      { once: true }
    );
  }

  return controller.signal;
}

/**
 * Run an async operation with cancellation support.
 *
 * The operation receives an AbortSignal that it should check periodically.
 * If the operation doesn't respect the signal, it will still be "cancelled"
 * from the caller's perspective, but the underlying work may continue.
 *
 * @param operation - Async function that receives an AbortSignal
 * @param options - Cancellation options (timeout, external signal, cleanup callback)
 * @returns Result with value, cancelled status, and any error
 *
 * @example
 * ```typescript
 * const result = await withCancellation(
 *   async (signal) => {
 *     // Check signal before expensive operations
 *     if (signal.aborted) throw new CancellationError();
 *
 *     const data = await fetchData();
 *
 *     // Check again before mutations
 *     if (signal.aborted) throw new CancellationError();
 *
 *     return processData(data);
 *   },
 *   { timeoutMs: 5000 }
 * );
 *
 * if (result.cancelled) {
 *   console.log('Operation was cancelled');
 * } else if (result.error) {
 *   console.error('Operation failed:', result.error);
 * } else {
 *   console.log('Result:', result.value);
 * }
 * ```
 */
export async function withCancellation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: CancellableOptions = {}
): Promise<CancellableResult<T>> {
  const { timeoutMs, signal: externalSignal, onCancel } = options;

  // Create internal abort controller for timeout
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  // Combine external signal with internal controller
  const combinedSignal = externalSignal
    ? combineAbortSignals(controller.signal, externalSignal)
    : controller.signal;

  // Set up timeout if specified
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      onCancel?.();
    }, timeoutMs);
  }

  // Listen to external signal (store handler for cleanup)
  let onExternalAbort: (() => void) | null = null;
  if (externalSignal) {
    onExternalAbort = () => {
      controller.abort();
      onCancel?.();
    };
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const value = await operation(combinedSignal);

    // Check if cancelled after operation completed (race condition protection)
    if (combinedSignal.aborted) {
      return { cancelled: true, timedOut };
    }

    return { value, cancelled: false, timedOut: false };
  } catch (error) {
    if (isCancellationError(error) || combinedSignal.aborted) {
      return { cancelled: true, timedOut };
    }
    return { cancelled: false, timedOut: false, error: error as Error };
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    // Clean up external signal listener to prevent memory leaks
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Check if an AbortSignal is aborted and throw CancellationError if so.
 * Use this at checkpoints within long-running operations.
 *
 * @param signal - The abort signal to check
 * @param message - Optional message for the CancellationError
 * @throws CancellationError if the signal is aborted
 *
 * @example
 * ```typescript
 * async function processItems(items: Item[], signal: AbortSignal) {
 *   for (const item of items) {
 *     checkCancellation(signal);
 *     await processItem(item);
 *   }
 * }
 * ```
 */
export function checkCancellation(signal: AbortSignal, message?: string): void {
  if (signal.aborted) {
    throw new CancellationError(message);
  }
}

/**
 * Create a deferred promise that can be resolved/rejected externally.
 * Useful for creating cancellable promise wrappers.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
