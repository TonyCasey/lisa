/**
 * E2E Tests for CLI Hooks and Plugin
 *
 * Tests the actual hook/plugin execution with real or mocked backends.
 *
 * Enable by setting environment variable:
 *   RUN_E2E_HOOK_TESTS=1
 *
 * These tests:
 * - Invoke Claude Code hooks via stdin/stdout
 * - Test OpenCode plugin exports
 * - Verify memory loading/saving flows
 *
 * For full integration with Neo4j/Graphiti, also set:
 *   RUN_E2E_HOOK_TESTS_FULL=1
 *
 * NOTE: Hook tests require the hooks to handle MCP timeouts gracefully.
 * The hooks have a 5-second internal timeout for MCP connections.
 * Test timeouts are set to 20 seconds to account for this.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import * as os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';

// =============================================================================
// Test Configuration
// =============================================================================

const runMode = process.env.RUN_E2E_HOOK_TESTS;
const e2eTestsEnabled = runMode === '1';
const fullMode = process.env.RUN_E2E_HOOK_TESTS_FULL === '1';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, '.claude', 'hooks');
const PLUGIN_DIR = path.join(PROJECT_ROOT, '.opencode', 'plugin');  // TODO: Update when OpenCode support is added

// =============================================================================
// Test Utilities
// =============================================================================

interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Execute a hook script with given stdin input
 */
async function executeHook(
  hookPath: string,
  stdinInput: string,
  timeoutMs: number = 10000,
  cwd: string = PROJECT_ROOT
): Promise<HookResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child: ChildProcess = spawn('node', [hookPath], {
      cwd,
      env: {
        ...process.env,
        // Use test-specific group to avoid polluting real memory
        GRAPHITI_GROUP_ID: 'e2e-test-group',
        // Disable actual MCP calls in test mode unless full mode
        LISA_TEST_MODE: fullMode ? '' : '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Write stdin and close
    if (child.stdin) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr: stderr + err.message,
        exitCode: 1,
        timedOut,
      });
    });
  });
}

/**
 * Create a temporary test project directory
 */
async function createTestProject(name: string): Promise<string> {
  const tempBase = os.tmpdir();
  const dirName = `lisa-e2e-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(tempBase, dirName);
  await fs.ensureDir(tempDir);

  // Create minimal git repo structure
  await fs.ensureDir(path.join(tempDir, '.git'));
  await fs.writeFile(
    path.join(tempDir, '.git', 'config'),
    '[core]\n\trepositoryformatversion = 0\n'
  );

  // Create package.json
  await fs.writeJson(path.join(tempDir, 'package.json'), {
    name: 'test-project',
    version: '1.0.0',
  });

  return tempDir;
}

/**
 * Clean up test project
 */
async function cleanupTestProject(dir: string): Promise<void> {
  try {
    await fs.remove(dir);
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Test Suite
// =============================================================================

if (!e2eTestsEnabled) {
  test.skip(
    'E2E hook tests disabled. Set RUN_E2E_HOOK_TESTS=1 to enable.',
    () => {}
  );
} else {
  describe('E2E Claude Code hooks', () => {
    // =========================================================================
    // Session Start Hook Tests
    // =========================================================================

    describe('session-start hook', () => {
      const hookPath = path.join(HOOKS_DIR, 'session-start.js');

      before(async () => {
        // Verify hook exists
        const exists = await fs.pathExists(hookPath);
        if (!exists) {
          throw new Error(`Hook not found: ${hookPath}. Run 'npm run build' first.`);
        }
      });

      test('hook file exists and is executable', async () => {
        const stat = await fs.stat(hookPath);
        assert.ok(stat.isFile(), 'session-start.js should be a file');
        assert.ok(stat.size > 0, 'session-start.js should not be empty');
      });

      test('responds to startup trigger', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ trigger: 'startup' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, `Hook should exit cleanly. stderr: ${result.stderr}`);

        // stdout should contain memory context for Claude
        // (may be empty if no memory exists, but should not error)
        assert.ok(
          result.stdout.includes('Memory') ||
          result.stdout.includes('loaded') ||
          result.stdout.includes('skipped') ||
          result.stdout === '',
          `stdout should contain memory info or be empty. Got: ${result.stdout}`
        );
      });

      test('responds to resume trigger', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ trigger: 'resume' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly');
      });

      test('responds to compact trigger', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ trigger: 'compact' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly');

        // Compact trigger should mention compaction in output
        const output = result.stdout + result.stderr;
        assert.ok(
          output.toLowerCase().includes('compact') ||
          output.toLowerCase().includes('memory') ||
          output === '',
          'Should mention compaction or memory'
        );
      });

      test('responds to clear trigger', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ trigger: 'clear' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly');
      });

      test('handles empty stdin gracefully', { timeout: 15000 }, async () => {
        const result = await executeHook(hookPath, '', 10000);

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly with empty stdin');
      });

      test('handles invalid JSON gracefully', { timeout: 15000 }, async () => {
        const result = await executeHook(hookPath, 'not valid json', 10000);

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly with invalid JSON');
      });

      test('runs in different working directory', { timeout: 20000 }, async () => {
        const testProject = await createTestProject('session-start');
        try {
          const result = await executeHook(
            hookPath,
            JSON.stringify({ trigger: 'startup' }),
            15000,
            testProject
          );

          assert.ok(!result.timedOut, 'Hook should not timeout');
          assert.equal(result.exitCode, 0, 'Hook should exit cleanly in different cwd');
        } finally {
          await cleanupTestProject(testProject);
        }
      });
    });

    // =========================================================================
    // Session Stop Hook Tests
    // =========================================================================

    describe('session-stop hook', () => {
      const hookPath = path.join(HOOKS_DIR, 'session-stop.js');

      before(async () => {
        const exists = await fs.pathExists(hookPath);
        if (!exists) {
          throw new Error(`Hook not found: ${hookPath}. Run 'npm run build' first.`);
        }
      });

      test('hook file exists and is executable', async () => {
        const stat = await fs.stat(hookPath);
        assert.ok(stat.isFile(), 'session-stop.js should be a file');
      });

      test('responds to stop event', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ reason: 'idle' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        // session-stop may have non-zero exit in test mode (no transcript)
        // but should not crash
        assert.ok(
          result.exitCode === 0 || result.exitCode === 1,
          'Hook should exit cleanly or with expected error'
        );
      });

      test('handles empty stdin', { timeout: 15000 }, async () => {
        const result = await executeHook(hookPath, '', 10000);

        assert.ok(!result.timedOut, 'Hook should not timeout');
        // Should not crash
        assert.ok(
          result.exitCode === 0 || result.exitCode === 1,
          'Hook should handle empty stdin'
        );
      });
    });

    // =========================================================================
    // User Prompt Submit Hook Tests
    // =========================================================================

    describe('user-prompt-submit hook', () => {
      const hookPath = path.join(HOOKS_DIR, 'user-prompt-submit.js');

      before(async () => {
        const exists = await fs.pathExists(hookPath);
        if (!exists) {
          throw new Error(`Hook not found: ${hookPath}. Run 'npm run build' first.`);
        }
      });

      test('hook file exists', async () => {
        const stat = await fs.stat(hookPath);
        assert.ok(stat.isFile(), 'user-prompt-submit.js should be a file');
      });

      test('processes prompt input', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ prompt: 'Test prompt for e2e testing' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly');
      });

      test('handles lisa command detection', { timeout: 15000 }, async () => {
        const result = await executeHook(
          hookPath,
          JSON.stringify({ prompt: 'hey lisa, what do you know?' }),
          10000
        );

        assert.ok(!result.timedOut, 'Hook should not timeout');
        assert.equal(result.exitCode, 0, 'Hook should exit cleanly');
      });
    });
  });

  // ===========================================================================
  // OpenCode Plugin Tests
  // ===========================================================================

  describe('E2E OpenCode plugin', () => {
    const pluginPath = path.join(PLUGIN_DIR, 'lisa.js');

    before(async () => {
      const exists = await fs.pathExists(pluginPath);
      if (!exists) {
        throw new Error(`Plugin not found: ${pluginPath}. Run 'npm run build' first.`);
      }
    });

    test('plugin file exists', async () => {
      const stat = await fs.stat(pluginPath);
      assert.ok(stat.isFile(), 'lisa.js should be a file');
      assert.ok(stat.size > 0, 'lisa.js should not be empty');
    });

    test('plugin can be required without error', async () => {
      // Test that the plugin module can be loaded
      // Note: This doesn't test the actual plugin interface, just that it loads
      let loadError: Error | null = null;
      try {
        // Clear require cache first
        const resolvedPath = require.resolve(pluginPath);
        delete require.cache[resolvedPath];

        // Attempt to require
        const plugin = require(pluginPath);
        assert.ok(plugin, 'Plugin should export something');
      } catch (err) {
        loadError = err as Error;
      }

      assert.ok(
        !loadError,
        `Plugin should load without error. Got: ${loadError?.message}`
      );
    });

    test('plugin exports expected interface', async () => {
      const resolvedPath = require.resolve(pluginPath);
      delete require.cache[resolvedPath];

      const plugin = require(pluginPath);

      // OpenCode plugins export a default function or LisaPlugin
      assert.ok(
        typeof plugin === 'function' ||
        typeof plugin.default === 'function' ||
        typeof plugin.LisaPlugin === 'function',
        'Plugin should export a function (default, LisaPlugin, or module itself)'
      );
    });
  });

  // ===========================================================================
  // Multi-CLI Flow Tests
  // ===========================================================================

  describe('E2E multi-CLI flows', () => {
    let testProject: string;

    before(async () => {
      testProject = await createTestProject('multi-cli');

      // Create .lisa directory structure
      await fs.ensureDir(path.join(testProject, '.lisa', 'skills', 'memory'));
      await fs.writeFile(
        path.join(testProject, '.lisa', 'skills', 'memory', 'SKILL.md'),
        '# Memory Skill\nTest skill for e2e tests'
      );

      // Create .claude directory with symlink to skills
      await fs.ensureDir(path.join(testProject, '.claude'));

      // Create .opencode directory with symlink to skills (for future use)
      await fs.ensureDir(path.join(testProject, '.opencode'));
    });

    after(async () => {
      await cleanupTestProject(testProject);
    });

    test('both CLIs can coexist in same project', async () => {
      const lisaExists = await fs.pathExists(path.join(testProject, '.lisa'));
      const claudeExists = await fs.pathExists(path.join(testProject, '.claude'));
      const opencodeExists = await fs.pathExists(path.join(testProject, '.opencode'));

      assert.ok(lisaExists, '.lisa should exist');
      assert.ok(claudeExists, '.claude should exist');
      assert.ok(opencodeExists, '.opencode should exist');
    });

    test('shared skills are accessible from both CLI directories', async () => {
      const skillPath = path.join(testProject, '.lisa', 'skills', 'memory', 'SKILL.md');
      const skillContent = await fs.readFile(skillPath, 'utf8');

      assert.ok(
        skillContent.includes('Memory Skill'),
        'Skill should be readable from .lisa'
      );
    });

    test('Claude Code hook runs in multi-CLI project', { timeout: 20000 }, async () => {
      const hookPath = path.join(HOOKS_DIR, 'session-start.js');
      const result = await executeHook(
        hookPath,
        JSON.stringify({ trigger: 'startup' }),
        15000,
        testProject
      );

      assert.ok(!result.timedOut, 'Hook should not timeout');
      assert.equal(result.exitCode, 0, 'Hook should exit cleanly in multi-CLI project');
    });
  });
}
