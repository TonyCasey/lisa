/**
 * Unit tests for SessionStartHookHandler
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'stream';
import { SessionStartHookHandler } from '../../../../../../../src/lib/application/handlers/hooks/SessionStartHookHandler';

/**
 * Create a readable stream from a string.
 */
function createReadable(data: string): Readable {
  return Readable.from([data]);
}

/**
 * Create a writable stream that collects output.
 */
function createWritable(): { writable: Writable; getOutput: () => string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  return {
    writable,
    getOutput: () => chunks.join(''),
  };
}

describe('SessionStartHookHandler', () => {
  let handler: SessionStartHookHandler;
  const originalEnv = process.env;

  beforeEach(() => {
    handler = new SessionStartHookHandler();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('execute', () => {
    test('outputs valid JSON to stdout', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'startup' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.ok(parsed.hookSpecificOutput, 'should have hookSpecificOutput');
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.ok(typeof parsed.hookSpecificOutput.additionalContext === 'string');
    });

    test('includes trigger message for startup', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'startup' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('Memory loaded for session start'), 
        'should include startup message');
    });

    test('includes trigger message for resume', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'resume' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('Memory loaded for session resume'), 
        'should include resume message');
    });

    test('includes trigger message for compact', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'compact' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('Memory reloaded after context compaction'), 
        'should include compact message');
    });

    test('includes trigger message for clear', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'clear' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('Memory loaded after context clear'), 
        'should include clear message');
    });

    test('includes user info in context', async () => {
      process.env.USER = 'testuser';
      const stdin = createReadable(JSON.stringify({ source: 'startup' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('User: testuser'), 'should include user');
    });

    test('writes status message to stderr', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'startup' }));
      const { writable: stdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const stderrOutput = getStderr();
      assert.ok(stderrOutput.includes('Lisa:'), 'should include Lisa status');
      assert.ok(stderrOutput.includes('memories'), 'should mention memories');
      assert.ok(stderrOutput.includes('tasks'), 'should mention tasks');
    });

    test('handles empty stdin gracefully', async () => {
      const stdin = createReadable('');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should still produce valid output
      assert.ok(parsed.hookSpecificOutput, 'should have hookSpecificOutput');
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    });

    test('handles invalid JSON stdin gracefully', async () => {
      const stdin = createReadable('not valid json');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should still produce valid output
      assert.ok(parsed.hookSpecificOutput, 'should have hookSpecificOutput');
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    });

    test('includes compact reminder for compact trigger', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'compact' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('skills may need to be re-invoked'), 
        'should include compact reminder');
    });

    test('includes clear reminder for clear trigger', async () => {
      const stdin = createReadable(JSON.stringify({ source: 'clear' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      const context = parsed.hookSpecificOutput.additionalContext;
      
      assert.ok(context.includes('/memory to recall'), 
        'should include clear reminder');
    });
  });
});
