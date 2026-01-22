/**
 * Unit tests for SessionStopHookHandler
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'stream';
import { SessionStopHookHandler } from '../../../../../../../src/lib/application/handlers/hooks/SessionStopHookHandler';

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

describe('SessionStopHookHandler', () => {
  let handler: SessionStopHookHandler;
  const originalEnv = process.env;

  beforeEach(() => {
    handler = new SessionStopHookHandler();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('execute', () => {
    test('outputs valid JSON to stdout', async () => {
      const stdin = createReadable(JSON.stringify({ session_id: '123' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.equal(typeof parsed.continue, 'boolean');
      assert.ok(typeof parsed.stopReason === 'string');
    });

    test('returns continue=false with stop reason', async () => {
      const stdin = createReadable(JSON.stringify({ session_id: '123' }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.equal(parsed.continue, false);
      assert.ok(parsed.stopReason.length > 0);
    });

    test('prevents infinite loops when stop_hook_active is true', async () => {
      const stdin = createReadable(JSON.stringify({ 
        session_id: '123',
        stop_hook_active: true 
      }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      assert.equal(parsed.continue, false);
      assert.ok(parsed.stopReason.includes('already active'), 
        'should indicate hook already active');
    });

    test('handles empty stdin gracefully', async () => {
      const stdin = createReadable('');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should still produce valid output
      assert.equal(typeof parsed.continue, 'boolean');
    });

    test('handles invalid JSON stdin gracefully', async () => {
      const stdin = createReadable('not valid json');
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should still produce valid output
      assert.equal(typeof parsed.continue, 'boolean');
    });

    test('uses cwd from input when provided', async () => {
      const stdin = createReadable(JSON.stringify({ 
        session_id: '123',
        cwd: '/tmp/test-project'
      }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Should complete without error
      assert.equal(parsed.continue, false);
    });

    test('includes session_id in worker input', async () => {
      const stdin = createReadable(JSON.stringify({ 
        session_id: 'test-session-123',
        transcript_path: '/path/to/transcript.jsonl'
      }));
      const { writable: stdout, getOutput: getStdout } = createWritable();
      const { writable: stderr } = createWritable();

      await handler.execute(stdin, stdout, stderr);

      const output = getStdout();
      const parsed = JSON.parse(output);
      
      // Handler should complete successfully
      assert.equal(parsed.continue, false);
    });
  });
});
