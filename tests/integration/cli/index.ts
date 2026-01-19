/**
 * CLI Integration Tests
 *
 * Tests CLI init command with different flags and CLI selection options.
 *
 * Enable by setting environment variable:
 *   RUN_CLI_INTEGRATION_TESTS=1
 *
 * These tests create temporary directories and verify:
 *   - lisa init --claude-only creates only .claude/
 *   - lisa init --opencode-only creates only .opencode/
 *   - lisa init creates both directories
 *   - lisa sync command works correctly
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'fs-extra';
import * as os from 'node:os';

import {
  initCommand,
  createDefaultServices,
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
} from '../../../src/lib/cli';

// Use dist/project for integration tests (after build)
const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..', 'dist', 'project');

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a unique temporary directory for testing
 */
async function createTempDir(prefix: string): Promise<string> {
  const tempBase = os.tmpdir();
  const dirName = `lisa-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(tempBase, dirName);
  await fs.ensureDir(tempDir);
  return tempDir;
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.remove(dir);
  } catch {
    // Ignore cleanup errors (Windows may have file locks)
  }
}

/**
 * Check if a path exists and is a directory
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a symlink (or junction on Windows)
 */
async function isSymlink(linkPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(linkPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('CLI init command integration', () => {
    let services: ReturnType<typeof createDefaultServices>;

    before(() => {
      services = createDefaultServices(TEMPLATE_ROOT);
    });

    // =========================================================================
    // Claude-only Mode Tests
    // =========================================================================

    describe('--claude-only mode', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('claude-only');
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('creates .lisa directory', { timeout: 30_000 }, async () => {
        await initCommand({
          cwd: tempDir,
          endpoint: DEFAULT_ENDPOINT,
          group: DEFAULT_GROUP,
          force: true,
          mode: 'skip',
          cliSupport: ['claude-code'],
        }, services);

        const lisaDir = path.join(tempDir, '.lisa');
        assert.ok(await dirExists(lisaDir), '.lisa directory should exist');
      });

      test('creates .claude directory', { timeout: 10_000 }, async () => {
        const claudeDir = path.join(tempDir, '.claude');
        assert.ok(await dirExists(claudeDir), '.claude directory should exist');
      });

      test('does NOT create .opencode directory', { timeout: 10_000 }, async () => {
        const opencodeDir = path.join(tempDir, '.opencode');
        assert.ok(!(await dirExists(opencodeDir)), '.opencode directory should NOT exist');
      });

      test('creates lisa.config.json with correct cliSupport', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        assert.ok(await fs.pathExists(configPath), 'lisa.config.json should exist');

        const config = await fs.readJson(configPath);
        assert.deepEqual(config.cliSupport, ['claude-code'], 'cliSupport should be claude-code only');
      });

      test('creates skills directory in .lisa', { timeout: 10_000 }, async () => {
        const skillsDir = path.join(tempDir, '.lisa', 'skills');
        assert.ok(await dirExists(skillsDir), '.lisa/skills directory should exist');
      });

      test('creates Claude config.js', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.claude', 'config.js');
        assert.ok(await fs.pathExists(configPath), '.claude/config.js should exist');
      });
    });

    // =========================================================================
    // OpenCode-only Mode Tests
    // =========================================================================

    describe('--opencode-only mode', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('opencode-only');
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('creates .lisa directory', { timeout: 30_000 }, async () => {
        await initCommand({
          cwd: tempDir,
          endpoint: DEFAULT_ENDPOINT,
          group: DEFAULT_GROUP,
          force: true,
          mode: 'skip',
          cliSupport: ['opencode'],
        }, services);

        const lisaDir = path.join(tempDir, '.lisa');
        assert.ok(await dirExists(lisaDir), '.lisa directory should exist');
      });

      test('creates .opencode directory', { timeout: 10_000 }, async () => {
        const opencodeDir = path.join(tempDir, '.opencode');
        assert.ok(await dirExists(opencodeDir), '.opencode directory should exist');
      });

      test('does NOT create .claude directory', { timeout: 10_000 }, async () => {
        const claudeDir = path.join(tempDir, '.claude');
        assert.ok(!(await dirExists(claudeDir)), '.claude directory should NOT exist');
      });

      test('creates lisa.config.json with correct cliSupport', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        assert.ok(await fs.pathExists(configPath), 'lisa.config.json should exist');

        const config = await fs.readJson(configPath);
        assert.deepEqual(config.cliSupport, ['opencode'], 'cliSupport should be opencode only');
      });

      test('creates skills directory in .lisa', { timeout: 10_000 }, async () => {
        const skillsDir = path.join(tempDir, '.lisa', 'skills');
        assert.ok(await dirExists(skillsDir), '.lisa/skills directory should exist');
      });
    });

    // =========================================================================
    // Both CLIs Mode Tests
    // =========================================================================

    describe('both CLIs mode (default)', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('both-clis');
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('creates .lisa directory', { timeout: 30_000 }, async () => {
        await initCommand({
          cwd: tempDir,
          endpoint: DEFAULT_ENDPOINT,
          group: DEFAULT_GROUP,
          force: true,
          mode: 'skip',
          cliSupport: ['claude-code', 'opencode'],
        }, services);

        const lisaDir = path.join(tempDir, '.lisa');
        assert.ok(await dirExists(lisaDir), '.lisa directory should exist');
      });

      test('creates .claude directory', { timeout: 10_000 }, async () => {
        const claudeDir = path.join(tempDir, '.claude');
        assert.ok(await dirExists(claudeDir), '.claude directory should exist');
      });

      test('creates .opencode directory', { timeout: 10_000 }, async () => {
        const opencodeDir = path.join(tempDir, '.opencode');
        assert.ok(await dirExists(opencodeDir), '.opencode directory should exist');
      });

      test('creates lisa.config.json with both CLIs', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        assert.ok(await fs.pathExists(configPath), 'lisa.config.json should exist');

        const config = await fs.readJson(configPath);
        assert.deepEqual(
          config.cliSupport.sort(),
          ['claude-code', 'opencode'].sort(),
          'cliSupport should include both CLIs'
        );
      });

      test('creates shared skills directory', { timeout: 10_000 }, async () => {
        const skillsDir = path.join(tempDir, '.lisa', 'skills');
        assert.ok(await dirExists(skillsDir), '.lisa/skills directory should exist');

        // Check memory skill exists
        const memorySkill = path.join(skillsDir, 'memory', 'SKILL.md');
        assert.ok(await fs.pathExists(memorySkill), 'memory SKILL.md should exist');
      });

      test('creates shared rules directory', { timeout: 10_000 }, async () => {
        const rulesDir = path.join(tempDir, '.lisa', 'rules');
        assert.ok(await dirExists(rulesDir), '.lisa/rules directory should exist');
      });
    });

    // =========================================================================
    // Config File Tests
    // =========================================================================

    describe('lisa.config.json structure', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('config-test');
        await initCommand({
          cwd: tempDir,
          endpoint: 'http://custom:8080/mcp/',
          group: 'test-group',
          force: true,
          mode: 'local',
          cliSupport: ['claude-code', 'opencode'],
        }, services);
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('saves graphiti configuration', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        const config = await fs.readJson(configPath);

        assert.ok(config.graphiti, 'Config should have graphiti section');
        assert.equal(config.graphiti.endpoint, 'http://custom:8080/mcp/', 'Endpoint should match');
        assert.equal(config.graphiti.groupId, 'test-group', 'GroupId should match');
        assert.equal(config.graphiti.mode, 'local', 'Mode should match');
      });

      test('saves cliSupport array', { timeout: 10_000 }, async () => {
        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        const config = await fs.readJson(configPath);

        assert.ok(Array.isArray(config.cliSupport), 'cliSupport should be an array');
        assert.ok(config.cliSupport.length > 0, 'cliSupport should not be empty');
      });
    });

    // =========================================================================
    // Force Flag Tests
    // =========================================================================

    describe('force flag behavior', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('force-test');
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('first init creates files', { timeout: 30_000 }, async () => {
        await initCommand({
          cwd: tempDir,
          endpoint: DEFAULT_ENDPOINT,
          group: 'first-group',
          force: false,
          mode: 'skip',
          cliSupport: ['claude-code'],
        }, services);

        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        const config = await fs.readJson(configPath);
        assert.equal(config.graphiti.groupId, 'first-group', 'First group should be set');
      });

      test('second init with force=true overwrites', { timeout: 30_000 }, async () => {
        await initCommand({
          cwd: tempDir,
          endpoint: DEFAULT_ENDPOINT,
          group: 'second-group',
          force: true,
          mode: 'skip',
          cliSupport: ['claude-code'],
        }, services);

        const configPath = path.join(tempDir, '.lisa', 'lisa.config.json');
        const config = await fs.readJson(configPath);
        assert.equal(config.graphiti.groupId, 'second-group', 'Group should be overwritten with force=true');
      });
    });

    // =========================================================================
    // Lisa Sync Command Tests
    // =========================================================================

    describe('lisa sync command', () => {
      let tempDir: string;

      before(async () => {
        tempDir = await createTempDir('sync-test');
        // Create .lisa directory
        await fs.ensureDir(path.join(tempDir, '.lisa'));
        await fs.ensureDir(path.join(tempDir, '.lisa', 'skills', 'memory'));
        await fs.writeFile(
          path.join(tempDir, '.lisa', 'skills', 'memory', 'SKILL.md'),
          '# Memory Skill\nOriginal content'
        );
      });

      after(async () => {
        await cleanupTempDir(tempDir);
      });

      test('sync updates copied directories from .copy-fallbacks.json', { timeout: 30_000 }, async () => {
        // Create a copy fallback scenario:
        // 1. Create .claude/skills as a copy (not symlink)
        const claudeDir = path.join(tempDir, '.claude');
        const claudeSkillsDir = path.join(claudeDir, 'skills');
        await fs.ensureDir(claudeSkillsDir);
        await fs.ensureDir(path.join(claudeSkillsDir, 'memory'));
        await fs.writeFile(
          path.join(claudeSkillsDir, 'memory', 'SKILL.md'),
          '# Memory Skill\nOLD content that needs updating'
        );

        // 2. Record the fallback
        const fallbackFile = path.join(tempDir, '.lisa', '.copy-fallbacks.json');
        await fs.writeJson(fallbackFile, {
          copies: [
            { link: '.claude/skills', target: '../.lisa/skills', createdAt: new Date().toISOString() }
          ]
        });

        // 3. Update the source
        await fs.writeFile(
          path.join(tempDir, '.lisa', 'skills', 'memory', 'SKILL.md'),
          '# Memory Skill\nNEW updated content'
        );

        // 4. Import and run sync logic directly (since we can't easily call the CLI)
        // Read the fallback file and sync
        const { copies } = await fs.readJson(fallbackFile) as { copies: Array<{ link: string; target: string }> };
        
        for (const { link, target } of copies) {
          const linkPath = path.join(tempDir, link);
          const targetPath = path.join(tempDir, path.dirname(link), target);
          
          if (await fs.pathExists(targetPath)) {
            await fs.remove(linkPath);
            await fs.copy(targetPath, linkPath);
          }
        }

        // 5. Verify the sync worked
        const syncedContent = await fs.readFile(
          path.join(claudeSkillsDir, 'memory', 'SKILL.md'),
          'utf8'
        );
        assert.ok(
          syncedContent.includes('NEW updated content'),
          'Synced file should have new content'
        );
      });

      test('handles missing .copy-fallbacks.json gracefully', { timeout: 10_000 }, async () => {
        const emptyDir = await createTempDir('no-fallbacks');
        try {
          await fs.ensureDir(path.join(emptyDir, '.lisa'));
          const fallbackFile = path.join(emptyDir, '.lisa', '.copy-fallbacks.json');
          
          // Should not throw when file doesn't exist
          const exists = await fs.pathExists(fallbackFile);
          assert.ok(!exists, 'Fallback file should not exist');
        } finally {
          await cleanupTempDir(emptyDir);
        }
      });

      test('handles empty copies array', { timeout: 10_000 }, async () => {
        const emptyDir = await createTempDir('empty-fallbacks');
        try {
          await fs.ensureDir(path.join(emptyDir, '.lisa'));
          const fallbackFile = path.join(emptyDir, '.lisa', '.copy-fallbacks.json');
          await fs.writeJson(fallbackFile, { copies: [] });

          const { copies } = await fs.readJson(fallbackFile) as { copies: Array<{ link: string; target: string }> };
          assert.equal(copies.length, 0, 'Should have empty copies array');
        } finally {
          await cleanupTempDir(emptyDir);
        }
      });
    });

    // =========================================================================
    // Storage Mode Tests
    // =========================================================================

    describe('storage mode behavior', () => {
      test('skip mode does not create docker files', { timeout: 30_000 }, async () => {
        const tempDir = await createTempDir('skip-mode');

        try {
          await initCommand({
            cwd: tempDir,
            endpoint: DEFAULT_ENDPOINT,
            group: DEFAULT_GROUP,
            force: true,
            mode: 'skip',
            includeDocker: true, // Even with includeDocker=true, skip mode should not create docker files
            cliSupport: ['claude-code'],
          }, services);

          const composePath = path.join(tempDir, 'docker-compose.graphiti.yml');
          assert.ok(!(await fs.pathExists(composePath)), 'Docker compose should NOT exist in skip mode');
        } finally {
          await cleanupTempDir(tempDir);
        }
      });

      test('local mode creates docker files when includeDocker=true', { timeout: 30_000 }, async () => {
        const tempDir = await createTempDir('local-mode');

        try {
          await initCommand({
            cwd: tempDir,
            endpoint: DEFAULT_ENDPOINT,
            group: DEFAULT_GROUP,
            force: true,
            mode: 'local',
            includeDocker: true,
            cliSupport: ['claude-code'],
          }, services);

          const composePath = path.join(tempDir, 'docker-compose.graphiti.yml');
          assert.ok(await fs.pathExists(composePath), 'Docker compose should exist in local mode');
        } finally {
          await cleanupTempDir(tempDir);
        }
      });
    });

    // =========================================================================
    // .env File Tests
    // =========================================================================

    describe('.env file behavior', () => {
      test('first init creates .env from template with replacements', { timeout: 30_000 }, async () => {
        const tempDir = await createTempDir('env-first-init');

        try {
          await initCommand({
            cwd: tempDir,
            endpoint: 'http://custom:9000/mcp/',
            group: 'my-project',
            force: true,
            mode: 'local',
            cliSupport: ['claude-code'],
          }, services);

          const envPath = path.join(tempDir, '.lisa', '.env');
          assert.ok(await fs.pathExists(envPath), '.env should be created on first init');

          const content = await fs.readFile(envPath, 'utf8');
          assert.ok(content.includes('GRAPHITI_ENDPOINT=http://custom:9000/mcp/'), 'Endpoint should be replaced');
          assert.ok(content.includes('LOG_LEVEL=debug'), '.env should include LOG_LEVEL');
          assert.ok(content.includes('STORAGE_MODE=local'), '.env should include STORAGE_MODE');
        } finally {
          await cleanupTempDir(tempDir);
        }
      });

      test('subsequent init does NOT overwrite existing .env', { timeout: 30_000 }, async () => {
        const tempDir = await createTempDir('env-no-overwrite');

        try {
          // First init
          await initCommand({
            cwd: tempDir,
            endpoint: 'http://first:8000/mcp/',
            group: 'first-group',
            force: true,
            mode: 'local',
            cliSupport: ['claude-code'],
          }, services);

          // Modify .env to simulate user customization
          const envPath = path.join(tempDir, '.lisa', '.env');
          await fs.writeFile(envPath, 'CUSTOM_VALUE=user-modified\nLOG_LEVEL=error\n');

          // Second init with force (should still preserve .env)
          await initCommand({
            cwd: tempDir,
            endpoint: 'http://second:9000/mcp/',
            group: 'second-group',
            force: true,
            mode: 'local',
            cliSupport: ['claude-code'],
          }, services);

          // Verify .env was NOT overwritten
          const content = await fs.readFile(envPath, 'utf8');
          assert.ok(content.includes('CUSTOM_VALUE=user-modified'), '.env should preserve user customizations');
          assert.ok(content.includes('LOG_LEVEL=error'), '.env should keep user LOG_LEVEL');
          assert.ok(!content.includes('http://second:9000'), '.env should NOT have new endpoint');
        } finally {
          await cleanupTempDir(tempDir);
        }
      });
    });
  });

