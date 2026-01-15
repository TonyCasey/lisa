/**
 * Tests for Version Bump Script
 *
 * Tests the semantic version bumping functionality including:
 * - Version parsing
 * - Major, minor, patch bumps
 * - Error handling for invalid inputs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Path to the compiled script
const SCRIPT_PATH = path.join(process.cwd(), '.agents', 'skills', 'git', 'scripts', 'bump-version.js');

// Create a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), `lisa-bump-test-${Date.now()}`);

/**
 * Helper to run the bump script with arguments in a specific directory
 */
async function runBumpScript(
  args: string[] = [],
  cwd: string = TEST_DIR,
  timeoutMs = 5000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH, ...args], {
      cwd,
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

    child.stdin.end();
  });
}

/**
 * Create a package.json with a specific version
 */
function createPackageJson(version: string, dir: string = TEST_DIR): void {
  const pkg = {
    name: 'test-package',
    version,
    description: 'Test package for bump-version tests',
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Read the version from package.json
 */
function readVersion(dir: string = TEST_DIR): string {
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

describe('bump-version script', () => {
  beforeEach(() => {
    // Create test directory
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('minor bump (default)', () => {
    it('should bump minor version by default', async () => {
      createPackageJson('1.2.3');

      const result = await runBumpScript([]);

      assert.strictEqual(result.exitCode, 0, 'Should exit with code 0');
      assert.strictEqual(readVersion(), '1.3.0', 'Minor version should be bumped, patch reset');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.status, 'ok');
      assert.strictEqual(output.bumpType, 'minor');
      assert.strictEqual(output.oldVersion, '1.2.3');
      assert.strictEqual(output.newVersion, '1.3.0');
    });

    it('should bump minor version with explicit argument', async () => {
      createPackageJson('2.5.9');

      const result = await runBumpScript(['minor']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '2.6.0');
    });
  });

  describe('patch bump', () => {
    it('should bump patch version only', async () => {
      createPackageJson('1.2.3');

      const result = await runBumpScript(['patch']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '1.2.4');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.bumpType, 'patch');
      assert.strictEqual(output.newVersion, '1.2.4');
    });

    it('should handle high patch numbers', async () => {
      createPackageJson('1.0.99');

      const result = await runBumpScript(['patch']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '1.0.100');
    });
  });

  describe('major bump', () => {
    it('should bump major and reset minor and patch', async () => {
      createPackageJson('1.5.9');

      const result = await runBumpScript(['major']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '2.0.0');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.bumpType, 'major');
      assert.strictEqual(output.newVersion, '2.0.0');
    });

    it('should handle version 0.x.x correctly', async () => {
      createPackageJson('0.9.5');

      const result = await runBumpScript(['major']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '1.0.0');
    });
  });

  describe('prerelease handling', () => {
    it('should strip prerelease suffix on bump', async () => {
      createPackageJson('1.2.3-beta.1');

      const result = await runBumpScript(['patch']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '1.2.4');
    });

    it('should strip alpha suffix on minor bump', async () => {
      createPackageJson('2.0.0-alpha');

      const result = await runBumpScript(['minor']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '2.1.0');
    });
  });

  describe('error handling', () => {
    it('should error on invalid bump type', async () => {
      createPackageJson('1.0.0');

      const result = await runBumpScript(['invalid']);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Invalid bump type'), `Expected error message, got: ${result.stderr}`);
    });

    it('should error when package.json not found', async () => {
      // Don't create package.json
      const result = await runBumpScript([]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('package.json not found'), `Expected error message, got: ${result.stderr}`);
    });

    it('should error when version field missing', async () => {
      // Create package.json without version
      const pkg = { name: 'test-package' };
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify(pkg, null, 2));

      const result = await runBumpScript([]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('No version field'), `Expected error message, got: ${result.stderr}`);
    });
  });

  describe('output format', () => {
    it('should output valid JSON to stdout', async () => {
      createPackageJson('1.0.0');

      const result = await runBumpScript([]);

      assert.strictEqual(result.exitCode, 0);

      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(result.stdout);
      }, 'stdout should be valid JSON');

      assert.ok(parsed.status, 'Should have status field');
      assert.ok(parsed.bumpType, 'Should have bumpType field');
      assert.ok(parsed.oldVersion, 'Should have oldVersion field');
      assert.ok(parsed.newVersion, 'Should have newVersion field');
      assert.ok(parsed.file, 'Should have file field');
    });

    it('should output human-readable message to stderr', async () => {
      createPackageJson('1.0.0');

      const result = await runBumpScript([]);

      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Bumped version'), 'stderr should have human-readable message');
      assert.ok(result.stderr.includes('1.0.0'), 'stderr should include old version');
      assert.ok(result.stderr.includes('1.1.0'), 'stderr should include new version');
    });
  });

  describe('package.json in parent directory', () => {
    it('should find package.json in parent directory', async () => {
      createPackageJson('3.0.0');

      // Create a subdirectory and run from there
      const subDir = path.join(TEST_DIR, 'src', 'lib');
      fs.mkdirSync(subDir, { recursive: true });

      const result = await runBumpScript([], subDir);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readVersion(), '3.1.0');
    });
  });
});
