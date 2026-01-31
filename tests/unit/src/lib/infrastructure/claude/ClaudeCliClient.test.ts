/**
 * Unit tests for ClaudeCliClient.
 *
 * Since the Claude CLI may not be installed in the test environment,
 * these tests focus on:
 * - Instance creation and interface conformance
 * - isAvailable returning a boolean (true or false depending on environment)
 * - runPrompt throwing when claude CLI is not available
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ClaudeCliClient } from '../../../../../../src/lib/infrastructure/claude/ClaudeCliClient';

describe('ClaudeCliClient', () => {
  const client = new ClaudeCliClient();

  describe('constructor', () => {
    it('should create an instance', () => {
      assert.ok(client);
      assert.ok(client instanceof ClaudeCliClient);
    });

    it('should have isAvailable method', () => {
      assert.strictEqual(typeof client.isAvailable, 'function');
    });

    it('should have runPrompt method', () => {
      assert.strictEqual(typeof client.runPrompt, 'function');
    });
  });

  describe('isAvailable', () => {
    it('should return a boolean', () => {
      const result = client.isAvailable();

      assert.strictEqual(typeof result, 'boolean');
    });

    it('should not throw regardless of whether claude is installed', () => {
      // isAvailable catches all errors internally and returns false
      assert.doesNotThrow(() => {
        client.isAvailable();
      });
    });

    it('should return consistent results on repeated calls', () => {
      const first = client.isAvailable();
      const second = client.isAvailable();

      assert.strictEqual(first, second, 'isAvailable should be deterministic');
    });
  });

  describe('runPrompt', () => {
    it('should throw when claude CLI is not available', () => {
      // If Claude CLI is not installed, runPrompt should throw.
      // If it is installed, this test still validates the contract by
      // skipping gracefully.
      const available = client.isAvailable();

      if (!available) {
        assert.throws(
          () => client.runPrompt('test prompt'),
          /./,
          'runPrompt should throw when Claude CLI is not available'
        );
      } else {
        // Claude CLI is installed -- we cannot safely run a prompt in tests
        // (it would make a real API call), so just verify the method exists.
        assert.strictEqual(typeof client.runPrompt, 'function');
      }
    });

    it('should accept options parameter', () => {
      const available = client.isAvailable();

      if (!available) {
        assert.throws(
          () => client.runPrompt('test prompt', { timeout: 1000, maxBuffer: 1024 }),
          /./,
          'runPrompt should throw when Claude CLI is not available'
        );
      } else {
        // Just verify the method signature accepts options.
        // Function.length counts declared parameters (prompt, options) = 2.
        assert.ok(client.runPrompt.length >= 1,
          'runPrompt should accept at least 1 parameter');
      }
    });
  });

  describe('IClaudeCliClient conformance', () => {
    it('should implement all interface methods', () => {
      const requiredMethods = ['isAvailable', 'runPrompt'];

      for (const method of requiredMethods) {
        assert.strictEqual(
          typeof (client as Record<string, unknown>)[method],
          'function',
          `Client should implement ${method}`
        );
      }
    });
  });
});
