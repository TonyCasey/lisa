import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import {
  CliExitError,
  getSkillCacheEnv,
  spawnAndWait,
  runPrWatchLoop,
  type IPrWatchLoopOptions,
} from '../../../../../src/lib/commands/cli-utils';
import type { IPrPollOptions, IPrPollResult } from '../../../../../src/lib/application/handlers';

/**
 * Create a minimal IPrPollResult for testing.
 */
function createPollResult(overrides?: Partial<IPrPollResult>): IPrPollResult {
  return {
    success: true,
    message: 'OK',
    polledAt: new Date().toISOString(),
    totalWatched: 1,
    totalChanges: 0,
    totalErrors: 0,
    items: [],
    ...overrides,
  };
}

describe('cli-utils', () => {
  describe('CliExitError', () => {
    it('should store the exit code', () => {
      const error = new CliExitError(42, 'something failed');
      assert.strictEqual(error.exitCode, 42);
      assert.strictEqual(error.message, 'something failed');
      assert.strictEqual(error.name, 'CliExitError');
    });

    it('should default message to empty string', () => {
      const error = new CliExitError(1);
      assert.strictEqual(error.message, '');
      assert.strictEqual(error.exitCode, 1);
    });

    it('should be an instance of Error', () => {
      const error = new CliExitError(1);
      assert.ok(error instanceof Error);
    });
  });

  describe('getSkillCacheEnv', () => {
    it('should set LISA_SKILL_CACHE_DIR when neither cache env var is set', () => {
      const originalCache = process.env.LISA_SKILL_CACHE_DIR;
      const originalCacheDir = process.env.LISA_CACHE_DIR;
      delete process.env.LISA_SKILL_CACHE_DIR;
      delete process.env.LISA_CACHE_DIR;

      try {
        const env = getSkillCacheEnv('memory');
        const expected = path.join(process.cwd(), '.lisa', 'skills', 'memory', 'cache');
        assert.strictEqual(env.LISA_SKILL_CACHE_DIR, expected);
      } finally {
        if (originalCache !== undefined) process.env.LISA_SKILL_CACHE_DIR = originalCache;
        else delete process.env.LISA_SKILL_CACHE_DIR;
        if (originalCacheDir !== undefined) process.env.LISA_CACHE_DIR = originalCacheDir;
        else delete process.env.LISA_CACHE_DIR;
      }
    });

    it('should not override LISA_SKILL_CACHE_DIR when already set', () => {
      const original = process.env.LISA_SKILL_CACHE_DIR;
      process.env.LISA_SKILL_CACHE_DIR = '/custom/path';

      try {
        const env = getSkillCacheEnv('memory');
        assert.strictEqual(env.LISA_SKILL_CACHE_DIR, '/custom/path');
      } finally {
        if (original !== undefined) process.env.LISA_SKILL_CACHE_DIR = original;
        else delete process.env.LISA_SKILL_CACHE_DIR;
      }
    });

    it('should not override when LISA_CACHE_DIR is set', () => {
      const originalSkill = process.env.LISA_SKILL_CACHE_DIR;
      const originalCache = process.env.LISA_CACHE_DIR;
      delete process.env.LISA_SKILL_CACHE_DIR;
      process.env.LISA_CACHE_DIR = '/global/cache';

      try {
        const env = getSkillCacheEnv('tasks');
        assert.strictEqual(env.LISA_SKILL_CACHE_DIR, undefined);
        assert.strictEqual(env.LISA_CACHE_DIR, '/global/cache');
      } finally {
        if (originalSkill !== undefined) process.env.LISA_SKILL_CACHE_DIR = originalSkill;
        else delete process.env.LISA_SKILL_CACHE_DIR;
        if (originalCache !== undefined) process.env.LISA_CACHE_DIR = originalCache;
        else delete process.env.LISA_CACHE_DIR;
      }
    });
  });

  describe('spawnAndWait', () => {
    it('should resolve when child process exits with code 0', async () => {
      // node -e "process.exit(0)" exits successfully
      await assert.doesNotReject(() =>
        spawnAndWait('-e', ['process.exit(0)'])
      );
    });

    it('should reject when child process exits with non-zero code', async () => {
      await assert.rejects(
        () => spawnAndWait('-e', ['process.exit(3)']),
        (err: Error) => {
          assert.ok(err.message.includes('exited with code'));
          return true;
        }
      );
    });

    it('should reject when script path does not exist', async () => {
      await assert.rejects(
        () => spawnAndWait('/nonexistent/script.js', []),
        (err: Error) => {
          assert.ok(err.message.includes('Failed to start skill') || err.message.includes('exited with code'));
          return true;
        }
      );
    });
  });

  describe('runPrWatchLoop', () => {
    let consoleLogs: string[];
    let originalLog: typeof console.log;

    beforeEach(() => {
      consoleLogs = [];
      originalLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('should throw when intervalMinutes is less than 1', async () => {
      const handler = { poll: mock.fn(() => Promise.resolve(createPollResult())) };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: 0,
        json: false,
        printResult: () => {},
        stopOnResolved: false,
      };

      await assert.rejects(
        () => runPrWatchLoop(options),
        (err: Error) => {
          assert.ok(err.message.includes('intervalMinutes must be >= 1'));
          return true;
        }
      );
      assert.strictEqual(handler.poll.mock.callCount(), 0);
    });

    it('should throw when intervalMinutes is negative', async () => {
      const handler = { poll: mock.fn(() => Promise.resolve(createPollResult())) };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: -5,
        json: false,
        printResult: () => {},
        stopOnResolved: false,
      };

      await assert.rejects(
        () => runPrWatchLoop(options),
        (err: Error) => {
          assert.ok(err.message.includes('intervalMinutes must be >= 1'));
          return true;
        }
      );
    });

    it('should throw when poll returns unsuccessful result', async () => {
      const handler = {
        poll: mock.fn(() => Promise.resolve(createPollResult({
          success: false,
          message: 'API error',
        }))),
      };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: 1,
        json: false,
        printResult: () => {},
        stopOnResolved: false,
      };

      await assert.rejects(
        () => runPrWatchLoop(options),
        (err: Error) => {
          assert.ok(err.message.includes('API error'));
          return true;
        }
      );
    });

    it('should stop when all comments are resolved and stopOnResolved is true', async () => {
      const result = createPollResult({
        items: [{
          number: 42,
          repo: 'owner/repo',
          title: 'Test PR',
          previousState: { status: 'open' as never, checksStatus: 'success' as never, unresolvedComments: 0 },
          currentState: { status: 'open' as never, checksStatus: 'success' as never, unresolvedComments: 0 },
          changes: [],
          unwatched: false,
        }],
        totalChanges: 0,
      });
      const handler = { poll: mock.fn(() => Promise.resolve(result)) };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: 1,
        json: false,
        printResult: () => {},
        stopOnResolved: true,
      };

      await runPrWatchLoop(options);
      assert.strictEqual(handler.poll.mock.callCount(), 1);
    });

    it('should output JSON when json option is true', async () => {
      const result = createPollResult({
        success: false,
        message: 'done',
      });
      const handler = { poll: mock.fn(() => Promise.resolve(result)) };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: 1,
        json: true,
        printResult: () => {},
        stopOnResolved: false,
      };

      // Will throw because success: false, but should still output JSON
      await assert.rejects(() => runPrWatchLoop(options));
      const jsonOutput = consoleLogs.find(l => l.includes('"success"'));
      assert.ok(jsonOutput, 'Should have output JSON');
      const parsed = JSON.parse(jsonOutput);
      assert.strictEqual(parsed.success, false);
    });

    it('should call printResult when there are changes', async () => {
      const result = createPollResult({
        success: false,
        totalChanges: 3,
        message: 'changes found',
      });
      const handler = { poll: mock.fn(() => Promise.resolve(result)) };
      const printResult = mock.fn();
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: {} as IPrPollOptions,
        intervalMinutes: 1,
        json: false,
        printResult,
        stopOnResolved: false,
      };

      await assert.rejects(() => runPrWatchLoop(options));
      assert.strictEqual(printResult.mock.callCount(), 1);
    });

    it('should show watching message when no changes and no errors', async () => {
      // First poll: no changes (shows watching). Second poll: fail to exit loop.
      let callCount = 0;
      const handler = {
        poll: mock.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(createPollResult({ totalChanges: 0, totalErrors: 0 }));
          }
          return Promise.resolve(createPollResult({ success: false, message: 'stop' }));
        }),
      };
      const options: IPrWatchLoopOptions = {
        handler,
        pollOptions: { prNumber: 99 } as IPrPollOptions,
        intervalMinutes: 1,
        json: false,
        printResult: () => {},
        stopOnResolved: false,
      };

      // Replace setTimeout to avoid waiting
      const origSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((fn: () => void) => { fn(); return 0; }) as never;
      try {
        await assert.rejects(() => runPrWatchLoop(options));
      } finally {
        globalThis.setTimeout = origSetTimeout;
      }

      const watchMsg = consoleLogs.find(l => l.includes('PR #99'));
      assert.ok(watchMsg, 'Should have shown watching message with PR label');
    });
  });
});
