/**
 * Cross-Platform Cron Service
 *
 * Manages scheduled tasks for PR polling on Windows, macOS, and Linux.
 * - Linux/macOS: Uses crontab
 * - Windows: Uses Task Scheduler (schtasks)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

import type {
  ICronService,
  ICronJobConfig,
  ICronConfig,
  ICronResult,
  CronPlatform,
  CronStatus,
  ILisaGlobalConfig,
} from '../../domain/interfaces/ICronService';

const execAsync = promisify(exec);

/** Task name for Windows Task Scheduler */
const WINDOWS_TASK_NAME = 'LisaPrPoll';

/** Marker comment for crontab entries */
const CRONTAB_MARKER = '# LISA_PR_POLL';

/** Cached absolute path to lisa binary */
let cachedLisaPath: string | null = null;

/**
 * Resolve the absolute path to the lisa binary.
 * Cron jobs run with minimal PATH, so we need the full path.
 * 
 * @returns The absolute path to lisa, or 'lisa' as fallback
 */
async function resolveLisaPath(): Promise<string> {
  if (cachedLisaPath) {
    return cachedLisaPath;
  }

  try {
    if (process.platform === 'win32') {
      // Windows: use 'where' command
      const { stdout } = await execAsync('where lisa', { timeout: 5000 });
      // 'where' can return multiple lines, take the first
      const lisaPath = stdout.trim().split(/\r?\n/)[0];
      if (lisaPath && await fs.pathExists(lisaPath)) {
        cachedLisaPath = lisaPath;
        return lisaPath;
      }
    } else {
      // Unix: use 'which' command
      const { stdout } = await execAsync('which lisa', { timeout: 5000 });
      const lisaPath = stdout.trim();
      if (lisaPath && await fs.pathExists(lisaPath)) {
        cachedLisaPath = lisaPath;
        return lisaPath;
      }
    }
  } catch {
    // Command failed, try npm global bin
  }

  // Fallback: try to find via npm global prefix
  try {
    const { stdout } = await execAsync('npm prefix -g', { timeout: 5000 });
    const npmPrefix = stdout.trim();
    const lisaBin = process.platform === 'win32'
      ? path.join(npmPrefix, 'lisa.cmd')
      : path.join(npmPrefix, 'bin', 'lisa');
    
    if (await fs.pathExists(lisaBin)) {
      cachedLisaPath = lisaBin;
      return lisaBin;
    }
  } catch {
    // npm command failed
  }

  // Last resort: return 'lisa' and hope PATH is configured
  return 'lisa';
}

/**
 * Clear the cached lisa path (for testing).
 */
export function clearLisaPathCache(): void {
  cachedLisaPath = null;
}

/**
 * Get the default log path.
 */
function getDefaultLogPath(): string {
  return path.join(os.homedir(), '.lisa', 'pr-poll.log');
}

/**
 * Get the config file path.
 */
function getConfigPath(customPath?: string): string {
  return customPath ?? path.join(os.homedir(), '.lisa', 'config.json');
}

/**
 * Options for CronService.
 */
export interface ICronServiceOptions {
  /** Custom path for config file (for testing) */
  configPath?: string;
}

/**
 * Cross-platform cron service implementation.
 */
export class CronService implements ICronService {
  private readonly configPath: string;

  constructor(options?: ICronServiceOptions) {
    this.configPath = getConfigPath(options?.configPath);
  }

  /**
   * Get the current platform's cron implementation.
   */
  getPlatform(): CronPlatform {
    switch (process.platform) {
      case 'win32':
        return 'windows-scheduler';
      case 'darwin':
      case 'linux':
        return 'crontab';
      default:
        return 'unsupported';
    }
  }

  /**
   * Check if cron job is currently installed.
   */
  async isInstalled(): Promise<CronStatus> {
    const platform = this.getPlatform();

    try {
      switch (platform) {
        case 'crontab':
          return await this.isCrontabInstalled();
        case 'windows-scheduler':
          return await this.isWindowsTaskInstalled();
        default:
          return 'not-installed';
      }
    } catch {
      return 'error';
    }
  }

  /**
   * Install the cron job.
   */
  async install(config: ICronJobConfig): Promise<ICronResult> {
    const platform = this.getPlatform();

    // Check if already installed
    const currentStatus = await this.isInstalled();
    if (currentStatus === 'installed') {
      // Uninstall first to update
      await this.uninstall();
    }

    try {
      switch (platform) {
        case 'crontab':
          return await this.installCrontab(config);
        case 'windows-scheduler':
          return await this.installWindowsTask(config);
        default:
          return {
            success: false,
            status: 'not-installed',
            platform,
            error: 'Unsupported platform',
            manualInstructions: this.getManualInstructions(config),
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        status: 'error',
        platform,
        error: errorMessage,
        manualInstructions: this.getManualInstructions(config),
      };
    }
  }

  /**
   * Uninstall the cron job.
   */
  async uninstall(): Promise<ICronResult> {
    const platform = this.getPlatform();

    try {
      switch (platform) {
        case 'crontab':
          return await this.uninstallCrontab();
        case 'windows-scheduler':
          return await this.uninstallWindowsTask();
        default:
          return {
            success: false,
            status: 'not-installed',
            platform,
            error: 'Unsupported platform',
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        status: 'error',
        platform,
        error: errorMessage,
      };
    }
  }

  /**
   * Get the current cron configuration from ~/.lisa/config.json.
   */
  async getConfig(): Promise<ICronConfig | null> {
    try {
    if (!await fs.pathExists(this.configPath)) {
        return null;
      }

      const content = await fs.readFile(this.configPath, 'utf-8');
      const config: ILisaGlobalConfig = JSON.parse(content);
      return config.prPolling ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Save cron configuration to ~/.lisa/config.json.
   */
  async saveConfig(cronConfig: ICronConfig): Promise<void> {
    const configDir = path.dirname(this.configPath);
    await fs.ensureDir(configDir);

    let config: ILisaGlobalConfig = {};

    // Read existing config if it exists
    if (await fs.pathExists(this.configPath)) {
      try {
        const content = await fs.readFile(this.configPath, 'utf-8');
        config = JSON.parse(content);
      } catch {
        // Ignore parse errors, start fresh
      }
    }

    // Update prPolling config
    config = {
      ...config,
      prPolling: cronConfig,
    };

    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Remove cron configuration from ~/.lisa/config.json.
   */
  async removeConfig(): Promise<void> {
    if (!await fs.pathExists(this.configPath)) {
      return;
    }

    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config: ILisaGlobalConfig = JSON.parse(content);

      // Remove prPolling key
      const { prPolling, ...rest } = config;
      
      if (Object.keys(rest).length === 0) {
        // No other config, delete file
        await fs.remove(this.configPath);
      } else {
        // Save without prPolling
        await fs.writeFile(this.configPath, JSON.stringify(rest, null, 2));
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get manual installation instructions for the current platform.
   */
  getManualInstructions(config: ICronJobConfig): string {
    const platform = this.getPlatform();
    const logPath = config.logPath ?? getDefaultLogPath();
    const notifyFlag = config.notify ? ' --notify' : '';

    switch (platform) {
      case 'crontab':
        return `
To manually set up PR polling, add this line to your crontab:
  
  crontab -e
  
Then add (use absolute path from 'which lisa'):
  */${config.intervalMinutes} * * * * $(which lisa) pr poll${notifyFlag} >> ${logPath} 2>&1

Or with explicit path (e.g., /usr/local/bin/lisa or ~/.nvm/.../bin/lisa):
  */${config.intervalMinutes} * * * * /path/to/lisa pr poll${notifyFlag} >> ${logPath} 2>&1

Note: Cron runs with minimal PATH, so using the absolute path is recommended.
Save and exit. The cron job will run every ${config.intervalMinutes} minutes.
`.trim();

      case 'windows-scheduler':
        return `
To manually set up PR polling, run this in PowerShell (as Administrator):

First, find the lisa path:
  where lisa

Then create the task with the full path:
  schtasks /create /tn "${WINDOWS_TASK_NAME}" /tr "C:\\path\\to\\lisa.cmd pr poll${notifyFlag}" /sc minute /mo ${config.intervalMinutes} /f

To remove later:
  schtasks /delete /tn "${WINDOWS_TASK_NAME}" /f
`.trim();

      default:
        return `
PR polling is not automatically supported on this platform.
Please set up a scheduled task manually to run:
  /full/path/to/lisa pr poll${notifyFlag}
every ${config.intervalMinutes} minutes.

Find the lisa path with: which lisa (Unix) or where lisa (Windows)
`.trim();
    }
  }

  // ============ Crontab (Linux/macOS) ============

  /**
   * Check if Lisa cron job is in crontab.
   */
  private async isCrontabInstalled(): Promise<CronStatus> {
    try {
      const { stdout } = await execAsync('crontab -l', { timeout: 5000 });
      if (stdout.includes(CRONTAB_MARKER)) {
        return 'installed';
      }
      return 'not-installed';
    } catch (error) {
      // crontab -l returns error if no crontab exists
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('no crontab')) {
        return 'not-installed';
      }
      return 'error';
    }
  }

  /**
   * Install Lisa cron job to crontab.
   */
  private async installCrontab(config: ICronJobConfig): Promise<ICronResult> {
    const logPath = config.logPath ?? getDefaultLogPath();
    const notifyFlag = config.notify ? ' --notify' : '';
    
    // Resolve absolute path to lisa binary (cron runs with minimal PATH)
    const lisaPath = await resolveLisaPath();
    const cronLine = `*/${config.intervalMinutes} * * * * ${lisaPath} pr poll${notifyFlag} >> ${logPath} 2>&1 ${CRONTAB_MARKER}`;

    // Get existing crontab (or empty if none)
    let existingCrontab = '';
    try {
      const { stdout } = await execAsync('crontab -l', { timeout: 5000 });
      existingCrontab = stdout;
    } catch {
      // No existing crontab, that's fine
    }

    // Remove any existing Lisa entries
    const lines = existingCrontab.split('\n').filter(line => !line.includes(CRONTAB_MARKER));
    
    // Add new entry
    lines.push(cronLine);

    // Install new crontab
    const newCrontab = lines.join('\n').trim() + '\n';
    
    // Use echo and pipe to crontab
    await execAsync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`, {
      timeout: 10000,
    });

    // Verify installation
    const status = await this.isCrontabInstalled();
    if (status !== 'installed') {
      return {
        success: false,
        status,
        platform: 'crontab',
        error: 'Failed to verify crontab installation',
        manualInstructions: this.getManualInstructions(config),
      };
    }

    // Save config
    await this.saveConfig({
      enabled: true,
      setupAt: new Date().toISOString(),
      platform: 'crontab',
      intervalMinutes: config.intervalMinutes,
      notify: config.notify ?? false,
    });

    return {
      success: true,
      status: 'installed',
      platform: 'crontab',
    };
  }

  /**
   * Uninstall Lisa cron job from crontab.
   */
  private async uninstallCrontab(): Promise<ICronResult> {
    // Get existing crontab
    let existingCrontab = '';
    try {
      const { stdout } = await execAsync('crontab -l', { timeout: 5000 });
      existingCrontab = stdout;
    } catch {
      // No existing crontab
      await this.removeConfig();
      return {
        success: true,
        status: 'not-installed',
        platform: 'crontab',
      };
    }

    // Remove Lisa entries
    const lines = existingCrontab.split('\n').filter(line => !line.includes(CRONTAB_MARKER));
    const newCrontab = lines.join('\n').trim();

    if (newCrontab) {
      // Install crontab without Lisa entries
      await execAsync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`, {
        timeout: 10000,
      });
    } else {
      // Remove crontab entirely if empty
      await execAsync('crontab -r', { timeout: 5000 }).catch(() => {
        // Ignore errors if no crontab
      });
    }

    // Remove config
    await this.removeConfig();

    return {
      success: true,
      status: 'not-installed',
      platform: 'crontab',
    };
  }

  // ============ Windows Task Scheduler ============

  /**
   * Check if Lisa task is in Windows Task Scheduler.
   */
  private async isWindowsTaskInstalled(): Promise<CronStatus> {
    try {
      await execAsync(`schtasks /query /tn "${WINDOWS_TASK_NAME}"`, {
        timeout: 10000,
      });
      return 'installed';
    } catch {
      return 'not-installed';
    }
  }

  /**
   * Install Lisa task to Windows Task Scheduler.
   */
  private async installWindowsTask(config: ICronJobConfig): Promise<ICronResult> {
    const notifyFlag = config.notify ? ' --notify' : '';
    
    // Resolve absolute path to lisa binary (Task Scheduler may not have full PATH)
    const lisaPath = await resolveLisaPath();
    const command = `"${lisaPath}" pr poll${notifyFlag}`;

    // Create scheduled task
    // /f forces overwrite if exists
    // /sc minute /mo N = every N minutes
    // /ru "" = run as current user
    const createCmd = `schtasks /create /tn "${WINDOWS_TASK_NAME}" /tr "${command}" /sc minute /mo ${config.intervalMinutes} /f`;

    try {
      await execAsync(createCmd, { timeout: 30000 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a permission error
      if (errorMessage.includes('Access is denied') || errorMessage.includes('ERROR')) {
        return {
          success: false,
          status: 'error',
          platform: 'windows-scheduler',
          error: 'Failed to create scheduled task. Try running as Administrator.',
          manualInstructions: this.getManualInstructions(config),
        };
      }
      throw error;
    }

    // Verify installation
    const status = await this.isWindowsTaskInstalled();
    if (status !== 'installed') {
      return {
        success: false,
        status,
        platform: 'windows-scheduler',
        error: 'Failed to verify task installation',
        manualInstructions: this.getManualInstructions(config),
      };
    }

    // Save config
    await this.saveConfig({
      enabled: true,
      setupAt: new Date().toISOString(),
      platform: 'windows-scheduler',
      intervalMinutes: config.intervalMinutes,
      notify: config.notify ?? false,
    });

    return {
      success: true,
      status: 'installed',
      platform: 'windows-scheduler',
    };
  }

  /**
   * Uninstall Lisa task from Windows Task Scheduler.
   */
  private async uninstallWindowsTask(): Promise<ICronResult> {
    try {
      // /f forces delete without confirmation
      await execAsync(`schtasks /delete /tn "${WINDOWS_TASK_NAME}" /f`, {
        timeout: 10000,
      });
    } catch {
      // Task might not exist, that's fine
    }

    // Remove config
    await this.removeConfig();

    return {
      success: true,
      status: 'not-installed',
      platform: 'windows-scheduler',
    };
  }
}

/**
 * Create a new CronService instance.
 */
export function createCronService(): ICronService {
  return new CronService();
}
