import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
import type { IServices } from '../../../../../src/lib/interfaces/IServices';

/**
 * Create a mock IServices object for testing.
 */
function createMockServices(overrides?: {
  dockerVersion?: string | Error;
  dockerComposeVersion?: string | Error;
  mcpPing?: void | Error;
}): IServices {
  return {
    templateCopier: {
      copy: mock.fn(() => Promise.resolve({ skipped: false })),
    },
    docker: {
      version: mock.fn(async () => {
        if (overrides?.dockerVersion instanceof Error) {
          throw overrides.dockerVersion;
        }
        return overrides?.dockerVersion ?? 'Docker version 24.0.0';
      }),
      composeVersion: mock.fn(async () => {
        if (overrides?.dockerComposeVersion instanceof Error) {
          throw overrides.dockerComposeVersion;
        }
        return overrides?.dockerComposeVersion ?? 'Docker Compose version v2.20.0';
      }),
      compose: mock.fn(() => Promise.resolve()),
    },
    mcp: {
      ping: mock.fn(async () => {
        if (overrides?.mcpPing instanceof Error) {
          throw overrides.mcpPing;
        }
      }),
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
      mode: 'local',
      group: 'test-project',
      endpoint: 'http://localhost:8010/mcp/',
      envFilePath: '/test/project/.lisa/.env',
      envFileExists: true,
      zepApiKeyConfigured: false,
    },
    checks: [
      { name: 'Lisa Structure', status: 'ok', message: '.lisa directory configured' },
      { name: 'Docker', status: 'ok', message: 'Docker 24.0.0', durationMs: 100 },
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

    it('should return error status when .lisa directory is missing', async () => {
      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.strictEqual(result.overallStatus, 'error');
      const lisaCheck = result.checks.find(c => c.name === 'Lisa Structure');
      assert.ok(lisaCheck);
      assert.strictEqual(lisaCheck.status, 'error');
      assert.ok(lisaCheck.message.includes('not found'));
    });

    it('should return ok status when .lisa directory exists with subdirs', async () => {
      // Create .lisa structure
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const lisaCheck = result.checks.find(c => c.name === 'Lisa Structure');
      assert.ok(lisaCheck);
      assert.strictEqual(lisaCheck.status, 'ok');
    });

    it('should check Docker in local mode', async () => {
      // Create .lisa with local mode
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=local\n'
      );

      const services = createMockServices({ dockerVersion: 'Docker version 24.0.0' });
      const result = await runDoctor({ cwd: tempDir }, services);

      const dockerCheck = result.checks.find(c => c.name === 'Docker');
      assert.ok(dockerCheck);
      assert.strictEqual(dockerCheck.status, 'ok');
      assert.ok(dockerCheck.message.includes('24.0.0'));
    });

    it('should report Docker error when Docker is unavailable', async () => {
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=local\n'
      );

      const services = createMockServices({
        dockerVersion: new Error('Docker daemon not running'),
      });
      const result = await runDoctor({ cwd: tempDir }, services);

      const dockerCheck = result.checks.find(c => c.name === 'Docker');
      assert.ok(dockerCheck);
      assert.strictEqual(dockerCheck.status, 'error');
      assert.ok(dockerCheck.details?.includes('Docker daemon'));
    });

    it('should not check Docker in skip mode', async () => {
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      const dockerCheck = result.checks.find(c => c.name === 'Docker');
      assert.strictEqual(dockerCheck, undefined);

      const storageCheck = result.checks.find(c => c.name === 'Storage Backend');
      assert.ok(storageCheck);
      assert.strictEqual(storageCheck.status, 'warning');
    });

    it('should check Claude Code hooks when .claude exists', async () => {
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

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
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

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

    it('should include timing information in checks', async () => {
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

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
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=local\nGRAPHITI_ENDPOINT=http://localhost:8010/mcp/\n'
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      assert.strictEqual(result.config.mode, 'local');
      // Group is now derived from folder path, not from env
      assert.ok(result.config.group.length > 0, 'Group should be derived from folder path');
      assert.strictEqual(result.config.endpoint, 'http://localhost:8010/mcp/');
      assert.strictEqual(result.config.envFileExists, true);
    });

    it('should derive group from folder path regardless of env config', async () => {
      fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.lisa', '.env'),
        'STORAGE_MODE=skip\n'
      );

      const services = createMockServices();
      const result = await runDoctor({ cwd: tempDir }, services);

      // Group should be the normalized folder path, not a package name or env var
      assert.ok(result.config.group.length > 0, 'Group should be non-empty');
      assert.ok(!result.config.group.includes(':'), 'Group should not contain colons');
      assert.ok(!result.config.group.includes('\\'), 'Group should not contain backslashes');
      assert.ok(!result.config.group.includes('/'), 'Group should not contain forward slashes');
    });
  });

  describe('formatBasicOutput', () => {
    it('should include mode and group', () => {
      const result = createMockResult();
      const output = formatBasicOutput(result);

      assert.ok(output.includes('Mode: local'));
      assert.ok(output.includes('Group: test-project'));
    });

    it('should show checkmarks for passing checks', () => {
      const result = createMockResult({
        checks: [
          { name: 'Test Check', status: 'ok', message: 'All good' },
        ],
      });
      const output = formatBasicOutput(result);

      // Check for the checkmark character
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
      assert.ok(output.includes('Mode: local'));
      assert.ok(output.includes('Group: test-project'));
      assert.ok(output.includes('Endpoint:'));
      assert.ok(output.includes('Env File:'));
    });

    it('should include health checks with timing', () => {
      const result = createMockResult({
        checks: [
          { name: 'Docker', status: 'ok', message: 'Docker 24.0.0', durationMs: 150 },
        ],
      });
      const output = formatVerboseOutput(result);

      assert.ok(output.includes('Health Checks'));
      assert.ok(output.includes('Docker'));
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
      assert.strictEqual(parsed.config.mode, result.config.mode);
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
        fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, '.lisa', '.env'),
          'STORAGE_MODE=skip\n'
        );
        fs.writeFileSync(
          path.join(tempDir, '.claude', 'settings.json'),
          JSON.stringify({ hooks: { SessionStart: ['lisa hook session-start'] } })
        );

        const services = createMockServices();
        const result = await runDoctor({ cwd: tempDir }, services);

        // In skip mode with all structure present, should be warning (skip mode itself is a warning)
        assert.strictEqual(result.overallStatus, 'warning');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should be error when any check has error status', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-doctor-test-'));
      try {
        // No .lisa directory = error
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
        fs.mkdirSync(path.join(tempDir, '.lisa', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.lisa', 'rules'), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, '.lisa', '.env'),
          'STORAGE_MODE=skip\n'
        );
        // No .claude directory = warning

        const services = createMockServices();
        const result = await runDoctor({ cwd: tempDir }, services);

        // Should have warnings (no .claude, skip mode) but no errors
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
