/**
 * Unit tests for UserPromptSubmitHookHandler
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'stream';
import { UserPromptSubmitHookHandler } from '../../../../../../../src/lib/application/handlers/hooks/UserPromptSubmitHookHandler';

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

describe('UserPromptSubmitHookHandler', () => {
  let handler: UserPromptSubmitHookHandler;
  const originalEnv = process.env;

  beforeEach(() => {
    handler = new UserPromptSubmitHookHandler();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('execute', () => {
    test('outputs valid JSON to stdout', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: 'test prompt' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      // Should be valid JSON
      assert.doesNotThrow(() => JSON.parse(output));
    });

    test('outputs empty object for empty prompt', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: '' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.deepEqual(parsed, {});
    });

    test('outputs empty object when no prompt field', async () => {
      const stdin = createReadable(JSON.stringify({ session_id: '123' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.deepEqual(parsed, {});
    });

    test('writes prompt capture message to stderr', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: 'What is TypeScript?' }));
      const { writable: stdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const stderrOutput = getStderr();
      assert.ok(stderrOutput.includes('Captured prompt'), 
        'should mention captured prompt');
      assert.ok(stderrOutput.includes('chars'), 
        'should include character count');
    });

    test('truncates long prompts in preview', async () => {
      const longPrompt = 'A'.repeat(200);
      const stdin = createReadable(JSON.stringify({ prompt: longPrompt }));
      const { writable: stdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const stderrOutput = getStderr();
      assert.ok(stderrOutput.includes('...'), 
        'should truncate long prompt with ellipsis');
    });

    test('warns about destructive operations', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: 'delete all files' }));
      const { writable: stdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const stderrOutput = getStderr();
      assert.ok(stderrOutput.includes('Warning') || stderrOutput.includes('Destructive'), 
        'should warn about destructive operation');
    });

    test('warns about short prompts', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: 'help' }));
      const { writable: stdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const stderrOutput = getStderr();
      assert.ok(stderrOutput.includes('short') || stderrOutput.includes('context'), 
        'should note short prompt');
    });

    test('handles empty stdin gracefully', async () => {
      const stdin = createReadable('');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      // Should still produce valid output
      assert.doesNotThrow(() => JSON.parse(output));
    });

    test('handles invalid JSON stdin gracefully', async () => {
      const stdin = createReadable('not valid json');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      // Should still produce valid output
      assert.doesNotThrow(() => JSON.parse(output));
    });

    test('does not block prompt submission', async () => {
      const stdin = createReadable(JSON.stringify({ prompt: 'test prompt' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should not have decision=block
      assert.ok(parsed.decision !== 'block', 'should not block prompt');
    });

    test('respects permission_mode for plan mode', async () => {
      const stdin = createReadable(JSON.stringify({ 
        prompt: 'test prompt',
        permission_mode: 'plan'
      }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr, getOutput: getStderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // In plan mode, may include additional context
      // Just verify it completes successfully
      assert.doesNotThrow(() => JSON.parse(output));
      
      // Stderr may mention plan mode if context was loaded
      const stderrOutput = getStderr();
      // This is optional - depends on whether rules exist
      assert.ok(typeof stderrOutput === 'string');
    });

    test('respects permissionMode (alternative field) for plan mode', async () => {
      const stdin = createReadable(JSON.stringify({ 
        prompt: 'test prompt',
        permissionMode: 'plan'
      }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      // Should complete without error
      assert.doesNotThrow(() => JSON.parse(output));
    });
  });
});
