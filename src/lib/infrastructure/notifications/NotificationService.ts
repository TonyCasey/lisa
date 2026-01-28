/**
 * Cross-Platform Notification Service
 *
 * Sends desktop notifications for PR events on Windows, macOS, and Linux.
 * Falls back to terminal bell and log file when desktop notifications unavailable.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

import type {
  INotificationService,
  INotification,
  INotificationResult,
  INotificationOptions,
  NotificationType,
  NotificationPriority,
} from '../../domain/interfaces/INotificationService';

const execAsync = promisify(exec);

/**
 * Lisa icon filename for toast notifications.
 */
const LISA_ICON_FILENAME = 'lisa-toast.png';

/**
 * Notification emoji/icon mapping.
 */
const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  checks_updated: '🔔',
  new_comment: '💬',
  comment_resolved: '✅',
  pr_approved: '🎉',
  pr_merged: '🚀',
  pr_closed: '🔒',
  new_reply: '💬',
};

/**
 * Default notification options.
 */
const DEFAULT_OPTIONS: Required<INotificationOptions> = {
  desktop: true,
  terminalBell: true,
  logToFile: true,
  debounceMs: 5000,
};

/**
 * Cross-platform notification service implementation.
 */
export class NotificationService implements INotificationService {
  private readonly options: Required<INotificationOptions>;
  private readonly logPath: string;
  private readonly iconPaths: string[];
  private desktopAvailable: boolean | null = null;
  private lastNotificationKey: string | null = null;
  private lastNotificationTime: number = 0;

  constructor(options?: INotificationOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.logPath = path.join(os.homedir(), '.lisa', 'notifications.log');
    // Check multiple locations for the icon:
    // 1. Global ~/.lisa/assets/ (user's home directory)
    // 2. Project-local .lisa/assets/ (current working directory)
    this.iconPaths = [
      path.join(os.homedir(), '.lisa', 'assets', LISA_ICON_FILENAME),
      path.join(process.cwd(), '.lisa', 'assets', LISA_ICON_FILENAME),
    ];
  }

  /**
   * Get the path to the Lisa icon for notifications.
   * Checks multiple locations and returns the first existing path.
   * Returns undefined if no icon is found.
   */
  async getIconPath(): Promise<string | undefined> {
    for (const iconPath of this.iconPaths) {
      try {
        await fs.access(iconPath);
        return iconPath;
      } catch {
        // Icon not found at this path, try next
      }
    }
    return undefined;
  }

  /**
   * Get the current platform.
   */
  getPlatform(): 'windows' | 'macos' | 'linux' | 'unknown' {
    switch (process.platform) {
      case 'win32':
        return 'windows';
      case 'darwin':
        return 'macos';
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }

  /**
   * Check if desktop notifications are available.
   */
  async isDesktopAvailable(): Promise<boolean> {
    if (this.desktopAvailable !== null) {
      return this.desktopAvailable;
    }

    const platform = this.getPlatform();

    try {
      switch (platform) {
        case 'windows':
          // Check if PowerShell is available
          await execAsync('powershell -Command "echo test"', { timeout: 5000 });
          this.desktopAvailable = true;
          break;

        case 'macos':
          // osascript is always available on macOS
          await execAsync('which osascript', { timeout: 5000 });
          this.desktopAvailable = true;
          break;

        case 'linux':
          // Check if notify-send is available
          await execAsync('which notify-send', { timeout: 5000 });
          this.desktopAvailable = true;
          break;

        default:
          this.desktopAvailable = false;
      }
    } catch {
      this.desktopAvailable = false;
    }

    return this.desktopAvailable;
  }

  /**
   * Send a notification.
   */
  async notify(notification: INotification): Promise<INotificationResult> {
    // Check debouncing
    const notificationKey = `${notification.type}:${notification.repo}#${notification.prNumber}`;
    const now = Date.now();

    if (
      this.lastNotificationKey === notificationKey &&
      now - this.lastNotificationTime < this.options.debounceMs
    ) {
      // Debounced - just log to file
      await this.writeToLog(notification);
      return { success: true, method: 'log' };
    }

    this.lastNotificationKey = notificationKey;
    this.lastNotificationTime = now;

    // Try desktop notification first
    if (this.options.desktop && await this.isDesktopAvailable()) {
      try {
        await this.sendDesktopNotification(notification);
        await this.writeToLog(notification);
        return { success: true, method: 'desktop' };
      } catch (error) {
        // Fall through to terminal fallback
      }
    }

    // Fallback to terminal bell
    if (this.options.terminalBell) {
      this.sendTerminalBell();
      await this.writeToLog(notification);
      return { success: true, method: 'terminal' };
    }

    // Just log
    if (this.options.logToFile) {
      await this.writeToLog(notification);
      return { success: true, method: 'log' };
    }

    return { success: false, method: 'log', error: 'All notification methods disabled' };
  }

  /**
   * Send multiple notifications with debouncing.
   */
  async notifyBatch(notifications: readonly INotification[]): Promise<readonly INotificationResult[]> {
    const results: INotificationResult[] = [];

    for (const notification of notifications) {
      const result = await this.notify(notification);
      results.push(result);
    }

    return results;
  }

  /**
   * Send a desktop notification.
   */
  private async sendDesktopNotification(notification: INotification): Promise<void> {
    const platform = this.getPlatform();
    const icon = NOTIFICATION_ICONS[notification.type];
    const title = this.escapeForShell(`${icon} ${notification.title}`);
    const body = this.escapeForShell(notification.body);
    const url = notification.url;

    switch (platform) {
      case 'windows':
        await this.sendWindowsNotification(title, body, url);
        break;

      case 'macos':
        await this.sendMacOSNotification(title, body);
        break;

      case 'linux':
        await this.sendLinuxNotification(title, body, notification.priority);
        break;

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Escape string for XML attribute context.
   */
  private escapeForXmlAttribute(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Send Windows toast notification via PowerShell.
   * Uses -EncodedCommand to avoid shell escaping issues with quotes.
   * If URL is provided, clicking the notification opens the URL.
   * Includes Lisa icon if available.
   */
  private async sendWindowsNotification(title: string, body: string, url?: string): Promise<void> {
    // Build launch attribute for clickable notifications (escape URL for XML safety)
    const launchAttr = url ? ` launch="${this.escapeForXmlAttribute(url)}" activationType="protocol"` : '';
    
    // Check if Lisa icon exists and escape all values for XML
    const iconPath = await this.getIconPath();
    // Windows toast requires file:/// protocol for local images
    const safeIconPath = iconPath 
      ? this.escapeForXmlAttribute('file:///' + iconPath.replace(/\\/g, '/'))
      : '';
    const iconElement = safeIconPath
      ? `<image placement="appLogoOverride" src="${safeIconPath}"/>`
      : '';
    
    // Escape title and body for XML text content (& < > can break LoadXml)
    const safeTitleXml = this.escapeForXmlAttribute(title);
    const safeBodyXml = this.escapeForXmlAttribute(body);
    
    // Use BurntToast if available, otherwise use basic Windows notification
    const script = `
      $ErrorActionPreference = 'Stop'
      
      # Try BurntToast first (more features)
      if (Get-Module -ListAvailable -Name BurntToast) {
        Import-Module BurntToast
        $iconPath = "${iconPath ? iconPath.replace(/\\/g, '\\\\') : ''}"
        if ($iconPath -and (Test-Path $iconPath)) {
          New-BurntToastNotification -Text "${title}", "${body}" -AppLogo $iconPath
        } else {
          New-BurntToastNotification -Text "${title}", "${body}" -AppLogo $null
        }
      } else {
        # Fallback to basic Windows notification with clickable URL support
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        
        $template = @"
<toast${launchAttr} duration="long">
  <visual>
    <binding template="ToastGeneric">
      ${iconElement}
      <text id="1">${safeTitleXml}</text>
      <text id="2">${safeBodyXml}</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Default"/>
</toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Lisa").Show($toast)
      }
    `;

    // Use -EncodedCommand to avoid escaping issues with quotes
    const base64Script = Buffer.from(script, 'utf16le').toString('base64');
    await execAsync(`powershell -NoProfile -EncodedCommand ${base64Script}`, {
      timeout: 10000,
    });
  }

  /**
   * Send macOS notification via osascript.
   * Uses proper AppleScript escaping for single quotes.
   * Note: macOS terminal-notifier could be used for icon support,
   * but osascript is available by default on all Macs.
   */
  private async sendMacOSNotification(title: string, body: string): Promise<void> {
    // Check if terminal-notifier is available (supports custom icons)
    const iconPath = await this.getIconPath();
    
    try {
      if (iconPath) {
        // Try terminal-notifier first (supports custom icons)
        await execAsync('which terminal-notifier', { timeout: 2000 });
        const safeTitle = title.replace(/"/g, '\\"');
        const safeBody = body.replace(/"/g, '\\"');
        await execAsync(
          `terminal-notifier -title "${safeTitle}" -message "${safeBody}" -contentImage "${iconPath}"`,
          { timeout: 10000 }
        );
        return;
      }
    } catch {
      // terminal-notifier not available, fall through to osascript
    }

    // Fallback to osascript (no icon support, but always available)
    // Escape single quotes for AppleScript by replacing ' with '"'"'
    // This ends the single-quoted string, adds a double-quoted apostrophe, then continues
    const escapeForAppleScript = (s: string): string =>
      s.replace(/'/g, "'\"'\"'");
    const safeTitle = escapeForAppleScript(title);
    const safeBody = escapeForAppleScript(body);
    const script = `display notification "${safeBody}" with title "${safeTitle}"`;
    await execAsync(`osascript -e '${script}'`, { timeout: 10000 });
  }

  /**
   * Send Linux notification via notify-send.
   * Includes Lisa icon if available.
   */
  private async sendLinuxNotification(
    title: string,
    body: string,
    priority: NotificationPriority
  ): Promise<void> {
    const urgency = this.mapPriorityToUrgency(priority);
    const iconPath = await this.getIconPath();
    const iconFlag = iconPath ? `-i "${iconPath}"` : '';
    await execAsync(`notify-send -u ${urgency} ${iconFlag} "${title}" "${body}"`, { timeout: 10000 });
  }

  /**
   * Map notification priority to Linux urgency level.
   */
  private mapPriorityToUrgency(priority: NotificationPriority): string {
    switch (priority) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'critical';
      case 'normal':
        return 'normal';
      case 'low':
        return 'low';
      default:
        return 'normal';
    }
  }

  /**
   * Send terminal bell.
   */
  private sendTerminalBell(): void {
    process.stdout.write('\x07');
  }

  /**
   * Write notification to log file.
   */
  private async writeToLog(notification: INotification): Promise<void> {
    if (!this.options.logToFile) {
      return;
    }

    try {
      const logDir = path.dirname(this.logPath);
      await fs.ensureDir(logDir);

      const icon = NOTIFICATION_ICONS[notification.type];
      const logEntry = `[${notification.timestamp}] ${icon} ${notification.repo}#${notification.prNumber}: ${notification.body}\n`;

      await fs.appendFile(this.logPath, logEntry);
    } catch {
      // Silently ignore log write failures
    }
  }

  /**
   * Escape string for shell commands (double-quoted contexts).
   * Platform-specific escaping is handled in each notification method.
   */
  private escapeForShell(str: string): string {
    // Escape characters that are special in double-quoted shell strings
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');
  }
}

/**
 * Create a notification from a state change.
 */
export function createNotificationFromStateChange(
  type: NotificationType,
  description: string,
  prNumber: number,
  repo: string,
  prTitle?: string
): INotification {
  const _icon = NOTIFICATION_ICONS[type];
  const shortRepo = repo.split('/').pop() || repo;

  let title: string;
  let body: string;
  let priority: NotificationPriority;

  switch (type) {
    case 'checks_updated':
      if (description.includes('success')) {
        title = `PR #${prNumber}: All checks passed`;
        priority = 'normal';
      } else if (description.includes('failure')) {
        title = `PR #${prNumber}: Checks failed`;
        priority = 'high';
      } else {
        title = `PR #${prNumber}: Checks updated`;
        priority = 'low';
      }
      body = `${shortRepo}: ${description}`;
      break;

    case 'new_comment':
      title = `PR #${prNumber}: New comment`;
      body = description;
      priority = 'normal';
      break;

    case 'new_reply':
      title = `PR #${prNumber}: New reply`;
      body = description;
      priority = 'high'; // Replies to your comments are important
      break;

    case 'comment_resolved':
      title = `PR #${prNumber}: Comment resolved`;
      body = description;
      priority = 'low';
      break;

    case 'pr_approved':
      title = `PR #${prNumber}: Approved!`;
      body = `${shortRepo}: ${prTitle || 'Ready to merge'}`;
      priority = 'high';
      break;

    case 'pr_merged':
      title = `PR #${prNumber}: Merged!`;
      body = `${shortRepo}: ${prTitle || 'PR merged successfully'}`;
      priority = 'normal';
      break;

    case 'pr_closed':
      title = `PR #${prNumber}: Closed`;
      body = `${shortRepo}: ${prTitle || 'PR was closed'}`;
      priority = 'low';
      break;

    default:
      title = `PR #${prNumber}`;
      body = description;
      priority = 'normal';
  }

  // Generate PR URL
  const url = `https://github.com/${repo}/pull/${prNumber}`;

  return {
    type,
    title,
    body,
    prNumber,
    repo,
    priority,
    timestamp: new Date().toISOString(),
    url,
  };
}
