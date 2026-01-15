/**
 * Tests for Session Start Hook
 *
 * Tests the trigger-aware session start functionality including:
 * - Trigger type detection from stdin
 * - Trigger-specific messaging
 * - Trigger-specific reminders (compact, clear)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as path from 'path';

// Path to the compiled hook
const HOOK_PATH = path.join(process.cwd(), '.claude', 'hooks', 'session-start.js');

/**
 * Helper to run the hook with stdin input and capture output
 */
async function runHookWithInput(
  input: Record<string, unknown>,
  timeoutMs = 10000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.on('error', (err) => {
      reject(err);
    });

    // Send input to stdin and close
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

describe('session-start hook', () => {
  describe('getTriggerMessage', () => {
    it('should return startup message for startup trigger', async () => {
      const result = await runHookWithInput({ trigger: 'startup' });
      assert.ok(
        result.stdout.includes('Memory loaded for session start'),
        `Expected startup message, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should return resume message for resume trigger', async () => {
      const result = await runHookWithInput({ trigger: 'resume' });
      assert.ok(
        result.stdout.includes('Memory loaded for session resume'),
        `Expected resume message, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should return compact message for compact trigger', async () => {
      const result = await runHookWithInput({ trigger: 'compact' });
      assert.ok(
        result.stdout.includes('Memory reloaded after context compaction'),
        `Expected compact message, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should return clear message for clear trigger', async () => {
      const result = await runHookWithInput({ trigger: 'clear' });
      assert.ok(
        result.stdout.includes('Memory loaded after context clear'),
        `Expected clear message, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should default to startup message for unknown trigger', async () => {
      const result = await runHookWithInput({ trigger: 'unknown' });
      assert.ok(
        result.stdout.includes('Memory loaded for session start'),
        `Expected default startup message, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should default to startup message when no input provided', async () => {
      const result = await runHookWithInput({});
      assert.ok(
        result.stdout.includes('Memory loaded for session start'),
        `Expected default startup message, got: ${result.stdout.slice(0, 200)}`
      );
    });
  });

  describe('getTriggerReminders', () => {
    it('should include skills reminder for compact trigger', async () => {
      const result = await runHookWithInput({ trigger: 'compact' });
      assert.ok(
        result.stdout.includes('Previously loaded skills may need to be re-invoked'),
        `Expected skills reminder for compact, got: ${result.stdout.slice(0, 400)}`
      );
    });

    it('should include fresh start reminder for clear trigger', async () => {
      const result = await runHookWithInput({ trigger: 'clear' });
      assert.ok(
        result.stdout.includes('Start fresh or use /memory'),
        `Expected fresh start reminder for clear, got: ${result.stdout.slice(0, 400)}`
      );
    });

    it('should not include reminders for startup trigger', async () => {
      const result = await runHookWithInput({ trigger: 'startup' });
      assert.ok(
        !result.stdout.includes('Previously loaded skills'),
        'Should not include skills reminder for startup'
      );
      assert.ok(
        !result.stdout.includes('Start fresh'),
        'Should not include fresh start reminder for startup'
      );
    });

    it('should not include reminders for resume trigger', async () => {
      const result = await runHookWithInput({ trigger: 'resume' });
      assert.ok(
        !result.stdout.includes('Previously loaded skills'),
        'Should not include skills reminder for resume'
      );
      assert.ok(
        !result.stdout.includes('Start fresh'),
        'Should not include fresh start reminder for resume'
      );
    });
  });

  describe('stderr output (user-visible)', () => {
    it('should show trigger type in stderr for compact', async () => {
      const result = await runHookWithInput({ trigger: 'compact' });
      assert.ok(
        result.stderr.includes('(compact)'),
        `Expected (compact) in stderr, got: ${result.stderr}`
      );
    });

    it('should show trigger type in stderr for resume', async () => {
      const result = await runHookWithInput({ trigger: 'resume' });
      assert.ok(
        result.stderr.includes('(resume)'),
        `Expected (resume) in stderr, got: ${result.stderr}`
      );
    });

    it('should show trigger type in stderr for clear', async () => {
      const result = await runHookWithInput({ trigger: 'clear' });
      assert.ok(
        result.stderr.includes('(clear)'),
        `Expected (clear) in stderr, got: ${result.stderr}`
      );
    });

    it('should not show trigger type for startup (default)', async () => {
      const result = await runHookWithInput({ trigger: 'startup' });
      assert.ok(
        !result.stderr.includes('(startup)'),
        `Should not show (startup) in stderr, got: ${result.stderr}`
      );
      assert.ok(
        result.stderr.includes('[Memory loaded:'),
        `Expected [Memory loaded: in stderr, got: ${result.stderr}`
      );
    });
  });

  describe('stdin parsing', () => {
    it('should accept session_type as alternative to trigger', async () => {
      const result = await runHookWithInput({ session_type: 'compact' });
      assert.ok(
        result.stdout.includes('Memory reloaded after context compaction'),
        `Expected compact message with session_type, got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should prefer trigger over session_type if both provided', async () => {
      const result = await runHookWithInput({ trigger: 'resume', session_type: 'compact' });
      assert.ok(
        result.stdout.includes('Memory loaded for session resume'),
        `Expected resume message (trigger takes precedence), got: ${result.stdout.slice(0, 200)}`
      );
    });

    it('should handle malformed JSON gracefully', async () => {
      // This tests that the hook doesn't crash with invalid input
      const child = spawn('node', [HOOK_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
        (resolve) => {
          child.on('close', (code) => {
            resolve({ stdout, stderr, exitCode: code ?? 0 });
          });

          // Send invalid JSON
          child.stdin.write('not valid json {{{');
          child.stdin.end();
        }
      );

      // Should default to startup and not crash
      assert.ok(
        result.stdout.includes('Memory loaded'),
        `Should handle malformed JSON, got: ${result.stdout.slice(0, 200)}`
      );
      assert.strictEqual(result.exitCode, 0, 'Should exit cleanly even with bad input');
    });
  });

  describe('exit behavior', () => {
    it('should exit with code 0 on success', async () => {
      const result = await runHookWithInput({ trigger: 'startup' });
      assert.strictEqual(result.exitCode, 0, 'Should exit with code 0');
    });
  });
});
