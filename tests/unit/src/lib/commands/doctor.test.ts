import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runDoctor,
  formatBasicOutput,
  formatVerboseOutput,
  formatJsonOutput,
  getExitCode,
  type IDoctorResult,
  type ICheckResult,
  type CheckStatus,
} from '../../../../../src/lib/commands/doctor';
import type { ICliServices } from '../../../../../src/lib/commands/cli-services';

/**
 * Create a mock ICliServices object for testing.
 * Note: Doctor no longer uses docker or mcp services, but the interface requires them.
 */
function createMockServices(): ICliServices {
  return {
    templateCopier: {
      copy: mock.fn(() => Promise.resolve({ skipped: false })),
    },
    docker: {
      version: mock.fn(async () => 'Docker version 24.0.0'),
      composeVersion: mock.fn(async () => 'Docker Compose version v2.20.0'),
      compose: mock.fn(() => Promise.resolve()),
    },
    mcp: {
      ping: mock.fn(() => Promise.resolve()),
    },
  };
}

/**
 * Create a minimal IDoctorResult for testing formatters.
 */
function createMockResult(overrides?: Partial<IDoctorResult>): IDoctorResult {
  return {
    timestamp: '2024-01-15T10:00:00.000Z',
    projectRoot: '/test/project',
    version: '2.5.2',
    overallStatus: 'ok',
    config: {
      storage: 'git-mem',
      projectName: 'test-project',
    },
    checks: [
      { name: 'Git Repository', status: 'ok', message: 'Git repository detected', durationMs: 10 },
      { name: 'Lisa Structure', status: 'ok', message: '.lisa directory configured', durationMs: 20 },
      { name: 'Claude Code Hooks', status: 'ok', message: '1 hook(s) configured', durationMs: 15 },
      { name: 'Git-Mem Storage', status: 'ok', message: 'Ready (no memories stored yet)', durationMs: 5 },
    ],
    transcripts: {
      searchPaths: ['/home/user/.claude/projects', '/home/user/.claude'],
      candidates: [],
    },
    totalDurationMs: 500,
    ...overrides,
  };
}

describe('Doctor Command', () => {
  describe('runDoctor', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-doctor-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should return error status when not a git repository', async () => {
      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.strictEqual(result.overallStatus, 'error');
      const gitCheck = result.checks.find(c => c.name === 'Git Repository');
      assert.ok(gitCheck);
      assert.strictEqual(gitCheck.status, 'error');
      assert.ok(gitCheck.message.includes('Not a git repository'));
    });

    it('should return error status when .lisa directory is missing', async () => {
      // Create .git to pass git check
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.strictEqual(result.overallStatus, 'error');
      const lisaCheck = result.checks.find(c => c.name === 'Lisa Structure');
      assert.ok(lisaCheck);
      assert.strictEqual(lisaCheck.status, 'error');
      assert.ok(lisaCheck.message.includes('not found'));
    });

    it('should return ok for Lisa Structure when .lisa directory exists with subdirs', async () => {
      // Create .git and .lisa structure
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const lisaCheck = result.checks.find(c => c.name === 'Lisa Structure');
      assert.ok(lisaCheck);
      assert.strictEqual(lisaCheck.status, 'ok');
    });

    it('should warn when .lisa subdirectories are missing', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      // Missing skills and rules

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const lisaCheck = result.checks.find(c => c.name === 'Lisa Structure');
      assert.ok(lisaCheck);
      assert.strictEqual(lisaCheck.status, 'warning');
      assert.ok(lisaCheck.message.includes('Missing directories'));
    });

    it('should check Git-Mem storage', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const gitMemCheck = result.checks.find(c => c.name === 'Git-Mem Storage');
      assert.ok(gitMemCheck);
      assert.strictEqual(gitMemCheck.status, 'ok');
      // When no notes exist yet, should say "Ready"
      assert.ok(gitMemCheck.message.includes('Ready'));
    });

    it('should detect git-mem notes when present', async () => {
      fs.mkdirSync(path.join(tempDir, '.git', 'refs', 'notes'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, '.git', 'refs', 'notes', 'mem'), 'test-ref');
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const gitMemCheck = result.checks.find(c => c.name === 'Git-Mem Storage');
      assert.ok(gitMemCheck);
      assert.strictEqual(gitMemCheck.status, 'ok');
      assert.ok(gitMemCheck.message.includes('Memory notes found'));
    });

    it('should detect git-mem notes from packed-refs', async () => {
      // Simulate packed refs (after git gc)
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.git', 'packed-refs'),
        '# pack-refs with: peeled fully-peeled sorted\nabc123 refs/notes/mem\n'
      );
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const gitMemCheck = result.checks.find(c => c.name === 'Git-Mem Storage');
      assert.ok(gitMemCheck);
      assert.strictEqual(gitMemCheck.status, 'ok');
      assert.ok(gitMemCheck.message.includes('Memory notes found'));
    });

    it('should check Claude Code hooks when .claude exists', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      // Create .claude with settings
      fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: ['lisa hook session-start'],
          },
        })
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const hooksCheck = result.checks.find(c => c.name === 'Claude Code Hooks');
      assert.ok(hooksCheck);
      assert.strictEqual(hooksCheck.status, 'ok');
      assert.ok(hooksCheck.message.includes('1 hook'));
    });

    it('should warn when no hooks are configured', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      // Create .claude with empty settings
      fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.claude', 'settings.json'),
        JSON.stringify({ hooks: {} })
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const hooksCheck = result.checks.find(c => c.name === 'Claude Code Hooks');
      assert.ok(hooksCheck);
      assert.strictEqual(hooksCheck.status, 'warning');
      assert.ok(hooksCheck.message.includes('No hooks'));
    });

    it('should warn when .claude directory is missing', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const hooksCheck = result.checks.find(c => c.name === 'Claude Code Hooks');
      assert.ok(hooksCheck);
      assert.strictEqual(hooksCheck.status, 'warning');
      assert.ok(hooksCheck.message.includes('not found'));
    });

    it('should include timing information in checks', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.ok(result.totalDurationMs >= 0);
      for (const check of result.checks) {
        if (check.durationMs !== undefined) {
          assert.ok(check.durationMs >= 0);
        }
      }
    });

    it('should populate config information correctly', async () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.strictEqual(result.config.storage, 'git-mem');
      assert.ok(result.config.projectName);
      // Project name should be derived from folder
      const expectedProjectName = path.basename(tempDir);
      assert.strictEqual(result.config.projectName, expectedProjectName);
    });
  });

  describe('formatBasicOutput', () => {
    it('should include project name and storage', () => {
      const result = createMockResult();
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Project: test-project'));
      assert.ok(output.includes('Storage: git-mem'));
    });

    it('should show checkmarks for passing checks', () => {
      const result = createMockResult({
        checks: [
          { name: 'Test Check', status: 'ok', message: 'All good' },
        ],
      });
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Test Check'));
      assert.ok(output.includes('All good'));
    });

    it('should show warning symbols for warnings', () => {
      const result = createMockResult({
        overallStatus: 'warning',
        checks: [
          { name: 'Warning Check', status: 'warning', message: 'Something concerning' },
        ],
      });
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Warning Check'));
      assert.ok(output.includes('Something concerning'));
    });

    it('should show error symbols for errors', () => {
      const result = createMockResult({
        overallStatus: 'error',
        checks: [
          { name: 'Error Check', status: 'error', message: 'Something failed' },
        ],
      });
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Error Check'));
      assert.ok(output.includes('Something failed'));
    });

    it('should include overall status and duration', () => {
      const result = createMockResult({ totalDurationMs: 1234 });
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Overall:'));
      assert.ok(output.includes('OK'));
    });
  });

  describe('formatVerboseOutput', () => {
    it('should include system information section', () => {
      const result = createMockResult({ version: '2.5.2' });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('System Information'));
      assert.ok(output.includes('Lisa Version: 2.5.2'));
      assert.ok(output.includes('Project Root:'));
    });

    it('should include configuration section', () => {
      const result = createMockResult();
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('Configuration'));
      assert.ok(output.includes('Project: test-project'));
      assert.ok(output.includes('Storage: git-mem'));
    });

    it('should include health checks with timing', () => {
      const result = createMockResult({
        checks: [
          { name: 'Git Repository', status: 'ok', message: 'Git repository detected', durationMs: 150 },
        ],
      });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('Health Checks'));
      assert.ok(output.includes('Git Repository'));
      assert.ok(output.includes('150ms'));
    });

    it('should include check details when present', () => {
      const result = createMockResult({
        checks: [
          {
            name: 'Failed Check',
            status: 'error',
            message: 'Connection failed',
            details: 'ECONNREFUSED 127.0.0.1:7687',
          },
        ],
      });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('ECONNREFUSED'));
    });

    it('should include transcript discovery section', () => {
      const result = createMockResult({
        transcripts: {
          searchPaths: ['/home/user/.claude/projects', '/home/user/.claude'],
          candidates: [
            {
              path: '/home/user/.claude/projects/test/transcript.jsonl',
              mtime: new Date('2024-01-15T10:00:00.000Z'),
              sizeBytes: 1024,
            },
          ],
          selected: '/home/user/.claude/projects/test/transcript.jsonl',
        },
      });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('Transcript Discovery'));
      assert.ok(output.includes('Search Paths'));
      assert.ok(output.includes('.claude'));
    });

    it('should include summary with counts', () => {
      const result = createMockResult({
        checks: [
          { name: 'Check 1', status: 'ok', message: 'OK' },
          { name: 'Check 2', status: 'ok', message: 'OK' },
          { name: 'Check 3', status: 'warning', message: 'Warn' },
          { name: 'Check 4', status: 'error', message: 'Err' },
        ],
      });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('Summary'));
      assert.ok(output.includes('2 passed'));
      assert.ok(output.includes('1 warnings'));
      assert.ok(output.includes('1 errors'));
    });
  });

  describe('formatJsonOutput', () => {
    it('should return valid JSON', () => {
      const result = createMockResult();
      const output = formatJsonOutput(result);

      const parsed = JSON.parse(output);
      assert.ok(parsed);
      assert.strictEqual(parsed.overallStatus, 'ok');
    });

    it('should preserve all result fields', () => {
      const result = createMockResult();
      const output = formatJsonOutput(result);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.timestamp, result.timestamp);
      assert.strictEqual(parsed.projectRoot, result.projectRoot);
      assert.strictEqual(parsed.version, result.version);
      assert.strictEqual(parsed.config.storage, result.config.storage);
      assert.strictEqual(parsed.config.projectName, result.config.projectName);
      assert.strictEqual(parsed.checks.length, result.checks.length);
    });

    it('should be prettified with indentation', () => {
      const result = createMockResult();
      const output = formatJsonOutput(result);

      // Check that it's formatted with newlines (not minified)
      assert.ok(output.includes('\n'));
      assert.ok(output.includes('  ')); // 2-space indentation
    });
  });

  describe('getExitCode', () => {
    it('should return 0 for ok status', () => {
      assert.strictEqual(getExitCode('ok'), 0);
    });

    it('should return 1 for warning status', () => {
      assert.strictEqual(getExitCode('warning'), 1);
    });

    it('should return 2 for error status', () => {
      assert.strictEqual(getExitCode('error'), 2);
    });
  });

  describe('overall status determination', () => {
    it('should be ok when all checks pass', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-doctor-test-'));
      try {
        // Set up all required structure
        fs.mkdirSync(path.join(tempDir, '.git', 'refs', 'notes'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.git', 'refs', 'notes', 'mem'), 'test-ref');
        fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, '.claude', 'settings.json'),
          JSON.stringify({ hooks: { SessionStart: ['lisa hook session-start'] } })
        );

        const services = createMockServices();
        const result = await runDoctor({ cwd: tempDir }, services);

        assert.strictEqual(result.overallStatus, 'ok');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should be error when any check has error status', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-doctor-test-'));
      try {
        // No .git directory = error
        const services = createMockServices();
        const result = await runDoctor({ cwd: tempDir }, services);

        assert.strictEqual(result.overallStatus, 'error');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should be warning when checks have warnings but no errors', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-doctor-test-'));
      try {
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
        // No .claude directory = warning

        const services = createMockServices();
        const result = await runDoctor({ cwd: tempDir }, services);

        // Should have warnings (no .claude) but no errors
        const hasError = result.checks.some(c => c.status === 'error');
        const hasWarning = result.checks.some(c => c.status === 'warning');

        assert.strictEqual(hasError, false);
        assert.strictEqual(hasWarning, true);
        assert.strictEqual(result.overallStatus, 'warning');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
