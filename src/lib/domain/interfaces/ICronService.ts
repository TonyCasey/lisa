/**
 * Cron Service Interface
 *
 * Cross-platform interface for managing scheduled tasks (cron jobs).
 * Supports Linux/macOS (crontab) and Windows (Task Scheduler).
 */

/**
 * Platform type for cron implementation.
 */
export type CronPlatform = 'crontab' | 'windows-scheduler' | 'unsupported';

/**
 * Status of the cron job installation.
 */
export type CronStatus = 'installed' | 'not-installed' | 'error';

/**
 * Configuration for a cron job.
 */
export interface ICronJobConfig {
  /** Unique identifier for the cron job */
  readonly name: string;
  /** Command to execute */
  readonly command: string;
  /** Schedule interval in minutes */
  readonly intervalMinutes: number;
  /** Whether to enable desktop notifications */
  readonly notify?: boolean;
  /** Path to log file (for crontab) */
  readonly logPath?: string;
}

/**
 * Stored cron configuration in ~/.lisa/config.json
 */
export interface ICronConfig {
  /** Whether PR polling is enabled */
  readonly enabled: boolean;
  /** When the cron job was set up */
  readonly setupAt: string;
  /** Platform used for scheduling */
  readonly platform: CronPlatform;
  /** Interval in minutes */
  readonly intervalMinutes: number;
  /** Whether notifications are enabled */
  readonly notify: boolean;
}

/**
 * Global Lisa configuration stored in ~/.lisa/config.json
 */
export interface ILisaGlobalConfig {
  /** PR polling cron configuration */
  readonly prPolling?: ICronConfig;
}

/**
 * Result of a cron operation.
 */
export interface ICronResult {
  /** Whether the operation succeeded */
  readonly success: boolean;
  /** Status after the operation */
  readonly status: CronStatus;
  /** Platform used */
  readonly platform: CronPlatform;
  /** Error message if failed */
  readonly error?: string;
  /** Manual instructions if automated setup failed */
  readonly manualInstructions?: string;
}

/**
 * Cross-platform cron service interface.
 */
export interface ICronService {
  /**
   * Get the current platform's cron implementation.
   */
  getPlatform(): CronPlatform;

  /**
   * Check if cron job is currently installed.
   */
  isInstalled(): Promise<CronStatus>;

  /**
   * Install the cron job.
   */
  install(config: ICronJobConfig): Promise<ICronResult>;

  /**
   * Uninstall the cron job.
   */
  uninstall(): Promise<ICronResult>;

  /**
   * Get the current cron configuration from ~/.lisa/config.json.
   */
  getConfig(): Promise<ICronConfig | null>;

  /**
   * Save cron configuration to ~/.lisa/config.json.
   */
  saveConfig(config: ICronConfig): Promise<void>;

  /**
   * Get manual installation instructions for the current platform.
   */
  getManualInstructions(config: ICronJobConfig): string;
}
