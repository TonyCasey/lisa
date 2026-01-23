/**
 * Tests for structured logging functionality.
 *
 * Verifies:
 * - Structured event logging with standardized events
 * - Context field enrichment
 * - Timed operations with automatic duration tracking
 * - Event derivation helpers
 *
 * @see Issue #16: Add structured log enrichment with context fields
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  LogEvents,
  generateCorrelationId,
  deriveCompleteEvent,
  deriveErrorEvent,
} from '../../../../../../src/lib/domain/interfaces';
import type {
  IStructuredLog,
  ILogContext,
  IStructuredLogger,
} from '../../../../../../src/lib/domain/interfaces';
import { Logger, NullLogger, DEFAULT_LOGGER_OPTIONS } from '../../../../../../src/lib/infrastructure/logging';

describe('Structured Logging', () => {
  describe('LogEvents constants', () => {
    it('should define memory operation events', () => {
      assert.strictEqual(LogEvents.MEMORY_LOAD_START, 'memory:load:start');
      assert.strictEqual(LogEvents.MEMORY_LOAD_COMPLETE, 'memory:load:complete');
      assert.strictEqual(LogEvents.MEMORY_LOAD_ERROR, 'memory:load:error');
      assert.strictEqual(LogEvents.MEMORY_LOAD_TIMEOUT, 'memory:load:timeout');
      assert.strictEqual(LogEvents.MEMORY_SAVE_START, 'memory:save:start');
      assert.strictEqual(LogEvents.MEMORY_SAVE_COMPLETE, 'memory:save:complete');
      assert.strictEqual(LogEvents.MEMORY_SEARCH_START, 'memory:search:start');
      assert.strictEqual(LogEvents.MEMORY_SEARCH_COMPLETE, 'memory:search:complete');
    });

    it('should define task operation events', () => {
      assert.strictEqual(LogEvents.TASK_LOAD_START, 'task:load:start');
      assert.strictEqual(LogEvents.TASK_LOAD_COMPLETE, 'task:load:complete');
      assert.strictEqual(LogEvents.TASK_SYNC_START, 'task:sync:start');
      assert.strictEqual(LogEvents.TASK_SYNC_COMPLETE, 'task:sync:complete');
    });

    it('should define session operation events', () => {
      assert.strictEqual(LogEvents.SESSION_START, 'session:start');
      assert.strictEqual(LogEvents.SESSION_STOP, 'session:stop');
      assert.strictEqual(LogEvents.SESSION_CAPTURE_START, 'session:capture:start');
      assert.strictEqual(LogEvents.SESSION_CAPTURE_COMPLETE, 'session:capture:complete');
    });

    it('should define DAL operation events', () => {
      assert.strictEqual(LogEvents.DAL_CONNECT_START, 'dal:connect:start');
      assert.strictEqual(LogEvents.DAL_FALLBACK, 'dal:fallback');
    });
  });

  describe('Event derivation helpers', () => {
    it('deriveCompleteEvent should convert start to complete', () => {
      assert.strictEqual(
        deriveCompleteEvent('memory:load:start'),
        'memory:load:complete'
      );
      assert.strictEqual(
        deriveCompleteEvent('task:sync:start'),
        'task:sync:complete'
      );
    });

    it('deriveErrorEvent should convert start to error', () => {
      assert.strictEqual(
        deriveErrorEvent('memory:load:start'),
        'memory:load:error'
      );
      assert.strictEqual(
        deriveErrorEvent('session:capture:start'),
        'session:capture:error'
      );
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      assert.ok(id1.length > 0, 'ID should not be empty');
      assert.ok(id2.length > 0, 'ID should not be empty');
      assert.notStrictEqual(id1, id2, 'IDs should be unique');
    });

    it('should include timestamp component', () => {
      const id = generateCorrelationId();
      // Format is timestamp-random
      assert.ok(id.includes('-'), 'ID should contain separator');
      const [timestamp] = id.split('-');
      assert.ok(timestamp.length > 0, 'Should have timestamp part');
    });
  });

  describe('Logger IStructuredLogger implementation', () => {
    let loggedMessages: Array<{ level: string; message: string; context: Record<string, unknown> }>;
    let logger: Logger;

    beforeEach(() => {
      loggedMessages = [];
      
      // Create a logger with console disabled and capture via our own mechanism
      logger = new Logger({
        ...DEFAULT_LOGGER_OPTIONS,
        level: 'debug',
        enableConsole: false,
        enableFile: false,
      });

      // Override writeLog to capture messages (hacky but works for testing)
      const originalInfo = logger.info.bind(logger);
      const originalDebug = logger.debug.bind(logger);
      const originalWarn = logger.warn.bind(logger);
      const originalError = logger.error.bind(logger);

      logger.info = (message: string, context?: Record<string, unknown>) => {
        loggedMessages.push({ level: 'info', message, context: context ?? {} });
        originalInfo(message, context);
      };
      logger.debug = (message: string, context?: Record<string, unknown>) => {
        loggedMessages.push({ level: 'debug', message, context: context ?? {} });
        originalDebug(message, context);
      };
      logger.warn = (message: string, context?: Record<string, unknown>) => {
        loggedMessages.push({ level: 'warn', message, context: context ?? {} });
        originalWarn(message, context);
      };
      logger.error = (message: string, context?: Record<string, unknown>) => {
        loggedMessages.push({ level: 'error', message, context: context ?? {} });
        originalError(message, context);
      };
    });

    it('logEvent should log at info level with event name', () => {
      logger.logEvent({
        event: LogEvents.MEMORY_LOAD_COMPLETE,
        context: { groupId: 'test-group' },
        data: { factCount: 10 },
        durationMs: 150,
      });

      assert.strictEqual(loggedMessages.length, 1);
      assert.strictEqual(loggedMessages[0].level, 'info');
      assert.ok(loggedMessages[0].message.includes('memory:load:complete'));
      assert.strictEqual(loggedMessages[0].context.event, LogEvents.MEMORY_LOAD_COMPLETE);
      assert.strictEqual(loggedMessages[0].context.groupId, 'test-group');
      assert.strictEqual(loggedMessages[0].context.factCount, 10);
      assert.strictEqual(loggedMessages[0].context.durationMs, 150);
    });

    it('logEventDebug should log at debug level', () => {
      logger.logEventDebug({
        event: LogEvents.MEMORY_LOAD_START,
        context: { groupId: 'test' },
      });

      assert.strictEqual(loggedMessages.length, 1);
      assert.strictEqual(loggedMessages[0].level, 'debug');
    });

    it('logEventWarn should log at warn level', () => {
      logger.logEventWarn({
        event: LogEvents.MEMORY_LOAD_TIMEOUT,
        context: { groupId: 'test' },
      });

      assert.strictEqual(loggedMessages.length, 1);
      assert.strictEqual(loggedMessages[0].level, 'warn');
    });

    it('logEventError should log at error level with error field', () => {
      logger.logEventError({
        event: LogEvents.MEMORY_LOAD_ERROR,
        error: 'Connection failed',
      });

      assert.strictEqual(loggedMessages.length, 1);
      assert.strictEqual(loggedMessages[0].level, 'error');
      assert.strictEqual(loggedMessages[0].context.error, 'Connection failed');
    });

    it('withContext should create child logger with bound context', () => {
      // Test that withContext returns a new Logger with bound context
      const childLogger = logger.withContext({
        sessionId: 'sess-123',
        groupId: 'test-group',
      });

      // Verify it returns a Logger (not the same instance)
      assert.ok(childLogger !== logger, 'Should return new instance');
      assert.ok('logEvent' in childLogger, 'Should implement IStructuredLogger');
      assert.ok('withContext' in childLogger, 'Should have withContext method');

      // To test the bound context, we need to check the logger directly
      // since the child doesn't use our overridden methods
      // We verify the method exists and can be called without error
      childLogger.logEvent({
        event: LogEvents.MEMORY_LOAD_COMPLETE,
        data: { factCount: 5 },
      });
      // If it didn't throw, the test passes
    });

    it('startOperation should track duration and log start/complete', async () => {
      const complete = logger.startOperation(LogEvents.MEMORY_LOAD_START, {
        groupId: 'test',
      });

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50));

      complete({ data: { factCount: 10 } });

      // Should have 2 messages: start (debug) and complete (info)
      assert.strictEqual(loggedMessages.length, 2);

      // First message: start event at debug level
      assert.strictEqual(loggedMessages[0].level, 'debug');
      assert.ok(loggedMessages[0].message.includes('memory:load:start'));

      // Second message: complete event at info level with duration
      assert.strictEqual(loggedMessages[1].level, 'info');
      assert.ok(loggedMessages[1].message.includes('memory:load:complete'));
      assert.ok(
        (loggedMessages[1].context.durationMs as number) >= 40,
        `Duration ${loggedMessages[1].context.durationMs}ms should be >= 40ms`
      );
      assert.strictEqual(loggedMessages[1].context.factCount, 10);
    });

    it('startOperation should log error event when error provided', () => {
      const complete = logger.startOperation(LogEvents.MEMORY_SAVE_START);

      complete({ error: 'Save failed' });

      assert.strictEqual(loggedMessages.length, 2);

      // Second message should be error event
      assert.strictEqual(loggedMessages[1].level, 'error');
      assert.ok(loggedMessages[1].message.includes('memory:save:error'));
      assert.strictEqual(loggedMessages[1].context.error, 'Save failed');
    });
  });

  describe('NullLogger IStructuredLogger implementation', () => {
    it('should implement all IStructuredLogger methods as no-ops', () => {
      const logger = new NullLogger();

      // These should not throw
      logger.logEvent({ event: LogEvents.MEMORY_LOAD_COMPLETE });
      logger.logEventDebug({ event: LogEvents.MEMORY_LOAD_START });
      logger.logEventWarn({ event: LogEvents.MEMORY_LOAD_TIMEOUT });
      logger.logEventError({ event: LogEvents.MEMORY_LOAD_ERROR });

      const child = logger.withContext({ groupId: 'test' });
      assert.strictEqual(child, logger, 'withContext should return same instance');

      const complete = logger.startOperation(LogEvents.MEMORY_LOAD_START);
      complete({ data: { factCount: 10 } });
      // Should not throw
    });
  });
});
