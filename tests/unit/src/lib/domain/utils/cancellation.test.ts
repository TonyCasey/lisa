import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  withCancellation,
  checkCancellation,
  CancellationError,
  isCancellationError,
  createDeferred,
} from '../../../../../../src/lib/domain/utils/cancellation';

describe('cancellation utilities', () => {
  describe('CancellationError', () => {
    it('should create error with default message', () => {
      const error = new CancellationError();
      assert.strictEqual(error.message, 'Operation was cancelled');
      assert.strictEqual(error.name, 'CancellationError');
    });

    it('should create error with custom message', () => {
      const error = new CancellationError('Custom cancellation message');
      assert.strictEqual(error.message, 'Custom cancellation message');
      assert.strictEqual(error.name, 'CancellationError');
    });
  });

  describe('isCancellationError', () => {
    it('should return true for CancellationError', () => {
      const error = new CancellationError();
      assert.strictEqual(isCancellationError(error), true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      assert.strictEqual(isCancellationError(error), false);
    });

    it('should return false for non-error values', () => {
      assert.strictEqual(isCancellationError(null), false);
      assert.strictEqual(isCancellationError(undefined), false);
      assert.strictEqual(isCancellationError('string'), false);
      assert.strictEqual(isCancellationError(42), false);
    });
  });

  describe('checkCancellation', () => {
    it('should not throw when signal is not aborted', () => {
      const controller = new AbortController();
      assert.doesNotThrow(() => checkCancellation(controller.signal));
    });

    it('should throw CancellationError when signal is aborted', () => {
      const controller = new AbortController();
      controller.abort();
      assert.throws(
        () => checkCancellation(controller.signal),
        CancellationError
      );
    });

    it('should throw with custom message when provided', () => {
      const controller = new AbortController();
      controller.abort();
      assert.throws(
        () => checkCancellation(controller.signal, 'Custom message'),
        (error: Error) => error.message === 'Custom message'
      );
    });
  });

  describe('withCancellation', () => {
    it('should return value when operation completes successfully', async () => {
      const result = await withCancellation(async () => {
        return 'success';
      });

      assert.strictEqual(result.value, 'success');
      assert.strictEqual(result.cancelled, false);
      assert.strictEqual(result.timedOut, false);
      assert.strictEqual(result.error, undefined);
    });

    it('should return error when operation throws', async () => {
      const expectedError = new Error('Operation failed');
      const result = await withCancellation(async () => {
        throw expectedError;
      });

      assert.strictEqual(result.value, undefined);
      assert.strictEqual(result.cancelled, false);
      assert.strictEqual(result.timedOut, false);
      assert.strictEqual(result.error, expectedError);
    });

    it('should cancel on timeout', async () => {
      const result = await withCancellation(
        async () => {
          // Simulate long-running operation
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should not return';
        },
        { timeoutMs: 50 }
      );

      assert.strictEqual(result.value, undefined);
      assert.strictEqual(result.cancelled, true);
      assert.strictEqual(result.timedOut, true);
    });

    it('should call onCancel callback when timeout occurs', async () => {
      let cancelCalled = false;

      await withCancellation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should not return';
        },
        {
          timeoutMs: 50,
          onCancel: () => {
            cancelCalled = true;
          },
        }
      );

      assert.strictEqual(cancelCalled, true);
    });

    it('should respect external abort signal', async () => {
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await withCancellation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should not return';
        },
        { signal: controller.signal }
      );

      assert.strictEqual(result.cancelled, true);
    });

    it('should pass abort signal to operation', async () => {
      let receivedSignal: AbortSignal | null = null;

      await withCancellation(
        async (signal) => {
          receivedSignal = signal;
          return 'done';
        },
        { timeoutMs: 5000 }
      );

      assert.notStrictEqual(receivedSignal, null);
      assert.ok(receivedSignal !== null && 'aborted' in receivedSignal);
    });

    it('should handle operation that checks cancellation', async () => {
      const result = await withCancellation(
        async (signal) => {
          // Simulate work
          await new Promise((resolve) => setTimeout(resolve, 10));
          checkCancellation(signal);
          await new Promise((resolve) => setTimeout(resolve, 10));
          checkCancellation(signal);
          return 'completed';
        },
        { timeoutMs: 5000 }
      );

      assert.strictEqual(result.value, 'completed');
      assert.strictEqual(result.cancelled, false);
    });

    it('should handle CancellationError thrown by operation', async () => {
      const result = await withCancellation(
        async (signal) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          throw new CancellationError('Manually cancelled');
        },
        { timeoutMs: 50 }
      );

      assert.strictEqual(result.cancelled, true);
      assert.strictEqual(result.timedOut, true);
    });

    it('should not set timedOut when cancelled by external signal', async () => {
      const controller = new AbortController();
      controller.abort(); // Abort immediately

      const result = await withCancellation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should not return';
        },
        { signal: controller.signal }
      );

      assert.strictEqual(result.cancelled, true);
      assert.strictEqual(result.timedOut, false);
    });

    it('should combine external signal with timeout', async () => {
      const controller = new AbortController();

      // External signal aborts immediately, timeout is 5000ms
      // External signal should win
      controller.abort();

      const result = await withCancellation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'should not return';
        },
        { timeoutMs: 5000, signal: controller.signal }
      );

      assert.strictEqual(result.cancelled, true);
      // timedOut should be false since external signal cancelled first
      assert.strictEqual(result.timedOut, false);
    });

    it('should clear timeout when operation completes', async () => {
      // This test verifies cleanup - if timeout isn't cleared,
      // it would fire after the test completes
      const result = await withCancellation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'quick result';
        },
        { timeoutMs: 5000 }
      );

      assert.strictEqual(result.value, 'quick result');
      assert.strictEqual(result.cancelled, false);
      assert.strictEqual(result.timedOut, false);
    });
  });

  describe('createDeferred', () => {
    it('should create a deferred promise that can be resolved', async () => {
      const deferred = createDeferred<string>();

      // Resolve after a delay
      setTimeout(() => deferred.resolve('resolved value'), 10);

      const result = await deferred.promise;
      assert.strictEqual(result, 'resolved value');
    });

    it('should create a deferred promise that can be rejected', async () => {
      const deferred = createDeferred<string>();
      const expectedError = new Error('rejected');

      // Reject after a delay
      setTimeout(() => deferred.reject(expectedError), 10);

      await assert.rejects(deferred.promise, expectedError);
    });
  });
});
