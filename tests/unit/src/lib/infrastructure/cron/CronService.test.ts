/**
 * Tests for CronService.
 *
 * Tests cross-platform cron service including:
 * - Platform detection
 * - Config file management
 * - Manual instructions generation
 * - Duplicate detection
 *
 * Note: Actual cron installation/uninstallation is not tested to avoid
 * modifying system state. These tests focus on the logic and config handling.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { CronService, createCronService } from '../../../../../../src/lib/infrastructure/cron/CronService';
import type {
  ICronConfig,
  ILisaGlobalConfig,
} from '../../../../../../src/lib/domain/interfaces/ICronService';

describe('CronService', () => {
  let tempDir: string;
  let configPath: string;
  let cronService: CronService;

  beforeEach(async () => {
    // Create temp directory for config
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisa-cron-test-'));
    configPath = path.join(tempDir, '.lisa', 'config.json');

    // Create service with custom config path
    cronService = new CronService({ configPath });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.remove(tempDir);
  });

  describe('getPlatform', () => {
    it('should return a valid platform', () => {
      const platform = cronService.getPlatform();
      assert.ok(['crontab', 'windows-scheduler', 'unsupported'].includes(platform));
    });

    it('should return windows-scheduler on win32', () => {
      if (process.platform === 'win32') {
        assert.strictEqual(cronService.getPlatform(), 'windows-scheduler');
      }
    });

    it('should return crontab on darwin', () => {
      if (process.platform === 'darwin') {
        assert.strictEqual(cronService.getPlatform(), 'crontab');
      }
    });

    it('should return crontab on linux', () => {
      if (process.platform === 'linux') {
        assert.strictEqual(cronService.getPlatform(), 'crontab');
      }
    });
  });

  describe('getConfig', () => {
    it('should return null when config file does not exist', async () => {
      const config = await cronService.getConfig();
      assert.strictEqual(config, null);
    });

    it('should return null when config file exists but has no prPolling', async () => {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, { otherConfig: true });

      const config = await cronService.getConfig();
      assert.strictEqual(config, null);
    });

    it('should return prPolling config when present', async () => {
      await fs.ensureDir(path.dirname(configPath));

      const expectedConfig: ICronConfig = {
        enabled: true,
        setupAt: '2026-01-27T12:00:00Z',
        platform: 'crontab',
        intervalMinutes: 5,
        notify: true,
      };

      const globalConfig: ILisaGlobalConfig = { prPolling: expectedConfig };
      await fs.writeJson(configPath, globalConfig);

      const config = await cronService.getConfig();
      assert.deepStrictEqual(config, expectedConfig);
    });

    it('should return null on parse error', async () => {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeFile(configPath, 'not valid json');

      const config = await cronService.getConfig();
      assert.strictEqual(config, null);
    });
  });

  describe('saveConfig', () => {
    it('should create config file if it does not exist', async () => {
      const cronConfig: ICronConfig = {
        enabled: true,
        setupAt: '2026-01-27T12:00:00Z',
        platform: 'crontab',
        intervalMinutes: 5,
        notify: true,
      };

      await cronService.saveConfig(cronConfig);

      assert.ok(await fs.pathExists(configPath));

      const saved = await fs.readJson(configPath);
      assert.deepStrictEqual(saved.prPolling, cronConfig);
    });

    it('should preserve other config when updating', async () => {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, { otherSetting: 'value' });

      const cronConfig: ICronConfig = {
        enabled: true,
        setupAt: '2026-01-27T12:00:00Z',
        platform: 'windows-scheduler',
        intervalMinutes: 10,
        notify: false,
      };

      await cronService.saveConfig(cronConfig);

      const saved = await fs.readJson(configPath);
      assert.strictEqual(saved.otherSetting, 'value');
      assert.deepStrictEqual(saved.prPolling, cronConfig);
    });

    it('should overwrite existing prPolling config', async () => {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, {
        prPolling: {
          enabled: false,
          setupAt: '2020-01-01T00:00:00Z',
          platform: 'crontab',
          intervalMinutes: 1,
          notify: false,
        },
      });

      const newConfig: ICronConfig = {
        enabled: true,
        setupAt: '2026-01-27T12:00:00Z',
        platform: 'windows-scheduler',
        intervalMinutes: 5,
        notify: true,
      };

      await cronService.saveConfig(newConfig);

      const saved = await fs.readJson(configPath);
      assert.deepStrictEqual(saved.prPolling, newConfig);
    });
  });

  describe('getManualInstructions', () => {
    it('should return crontab instructions for crontab platform', () => {
      const instructions = cronService.getManualInstructions({
        name: 'test',
        command: 'lisa pr poll',
        intervalMinutes: 5,
        notify: true,
      });

      if (cronService.getPlatform() === 'crontab') {
        assert.ok(instructions.includes('crontab -e'));
        assert.ok(instructions.includes('*/5 * * * *'));
        assert.ok(instructions.includes('--notify'));
      }
    });

    it('should return schtasks instructions for windows-scheduler platform', () => {
      const instructions = cronService.getManualInstructions({
        name: 'test',
        command: 'lisa pr poll',
        intervalMinutes: 5,
        notify: false,
      });

      if (cronService.getPlatform() === 'windows-scheduler') {
        assert.ok(instructions.includes('schtasks'));
        assert.ok(instructions.includes('/sc minute'));
        assert.ok(instructions.includes('/mo 5'));
        assert.ok(!instructions.includes('--notify'));
      }
    });

    it('should include notify flag when notify is true', () => {
      const instructions = cronService.getManualInstructions({
        name: 'test',
        command: 'lisa pr poll',
        intervalMinutes: 5,
        notify: true,
      });

      if (cronService.getPlatform() !== 'unsupported') {
        assert.ok(instructions.includes('--notify'));
      }
    });

    it('should not include notify flag when notify is false', () => {
      const instructions = cronService.getManualInstructions({
        name: 'test',
        command: 'lisa pr poll',
        intervalMinutes: 5,
        notify: false,
      });

      // The command should not have --notify (but might have other occurrences of 'notify')
      const lines = instructions.split('\n');
      const commandLines = lines.filter(l => l.includes('lisa pr poll'));
      for (const line of commandLines) {
        assert.ok(!line.includes('--notify'));
      }
    });

    it('should use custom interval', () => {
      const instructions = cronService.getManualInstructions({
        name: 'test',
        command: 'lisa pr poll',
        intervalMinutes: 10,
        notify: false,
      });

      if (cronService.getPlatform() === 'crontab') {
        assert.ok(instructions.includes('*/10'));
      } else if (cronService.getPlatform() === 'windows-scheduler') {
        assert.ok(instructions.includes('/mo 10'));
      }
    });
  });

  describe('isInstalled', () => {
    it('should return a valid status', async () => {
      const status = await cronService.isInstalled();
      assert.ok(['installed', 'not-installed', 'error'].includes(status));
    });
  });

  describe('createCronService factory', () => {
    it('should create a CronService instance', () => {
      const service = createCronService();
      assert.ok(service instanceof CronService);
    });
  });

  describe('install result structure', () => {
    it('should return proper result for unsupported platform', async () => {
      // Force platform to unsupported by checking current platform
      const platform = cronService.getPlatform();

      // We can only test the return structure, not the actual installation
      // This tests that install() returns a proper ICronResult
      const result = await cronService.install({
        name: 'test',
        command: 'echo test',
        intervalMinutes: 5,
      });

      assert.ok('success' in result);
      assert.ok('status' in result);
      assert.ok('platform' in result);

      // If unsupported, should fail with manual instructions
      if (platform === 'unsupported') {
        assert.strictEqual(result.success, false);
        assert.ok(result.manualInstructions);
      }
    });
  });

  describe('uninstall result structure', () => {
    it('should return proper result structure', async () => {
      const result = await cronService.uninstall();

      assert.ok('success' in result);
      assert.ok('status' in result);
      assert.ok('platform' in result);
    });
  });

  describe('config removal', () => {
    it('should remove prPolling from config on uninstall', async () => {
      // First save a config
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, {
        prPolling: {
          enabled: true,
          setupAt: '2026-01-27T12:00:00Z',
          platform: 'crontab',
          intervalMinutes: 5,
          notify: true,
        },
        otherConfig: 'preserved',
      });

      // Call removeConfig (internal method, test via uninstall effect)
      await cronService.uninstall();

      // Config file should still exist (has other config)
      assert.ok(await fs.pathExists(configPath));

      // But prPolling should be removed
      const saved = await fs.readJson(configPath);
      assert.strictEqual(saved.prPolling, undefined);
      assert.strictEqual(saved.otherConfig, 'preserved');
    });

    it('should delete config file if only prPolling exists', async () => {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJson(configPath, {
        prPolling: {
          enabled: true,
          setupAt: '2026-01-27T12:00:00Z',
          platform: 'crontab',
          intervalMinutes: 5,
          notify: true,
        },
      });

      await cronService.uninstall();

      // Config file should be deleted
      assert.ok(!await fs.pathExists(configPath));
    });
  });
});
