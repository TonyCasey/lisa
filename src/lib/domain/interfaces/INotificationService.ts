/**
 * Notification Service Interface
 *
 * Provides cross-platform desktop notifications for PR events.
 * Supports Windows (PowerShell), macOS (osascript), and Linux (notify-send).
 */

/**
 * Notification event types matching IStateChange from PrPollHandler.
 */
export type NotificationType =
  | 'checks_updated'
  | 'new_comment'
  | 'comment_resolved'
  | 'pr_approved'
  | 'pr_merged'
  | 'pr_closed'
  | 'new_reply';

/**
 * Notification priority levels.
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * A notification to be displayed.
 */
export interface INotification {
  /** Notification type */
  readonly type: NotificationType;
  /** Notification title */
  readonly title: string;
  /** Notification body/message */
  readonly body: string;
  /** PR number */
  readonly prNumber: number;
  /** Repository (owner/repo) */
  readonly repo: string;
  /** Priority level */
  readonly priority: NotificationPriority;
  /** Timestamp */
  readonly timestamp: string;
}

/**
 * Result of sending a notification.
 */
export interface INotificationResult {
  /** Whether the notification was sent successfully */
  readonly success: boolean;
  /** Method used to send (desktop, terminal, log) */
  readonly method: 'desktop' | 'terminal' | 'log';
  /** Error message if failed */
  readonly error?: string;
}

/**
 * Notification service options.
 */
export interface INotificationOptions {
  /** Enable desktop notifications (default: true) */
  readonly desktop?: boolean;
  /** Enable terminal bell fallback (default: true) */
  readonly terminalBell?: boolean;
  /** Write to log file (default: true) */
  readonly logToFile?: boolean;
  /** Debounce window in ms (default: 5000) */
  readonly debounceMs?: number;
}

/**
 * Service for sending cross-platform notifications.
 */
export interface INotificationService {
  /**
   * Send a notification.
   */
  notify(notification: INotification): Promise<INotificationResult>;

  /**
   * Send multiple notifications (with debouncing).
   */
  notifyBatch(notifications: readonly INotification[]): Promise<readonly INotificationResult[]>;

  /**
   * Check if desktop notifications are available on this platform.
   */
  isDesktopAvailable(): Promise<boolean>;

  /**
   * Get the current platform.
   */
  getPlatform(): 'windows' | 'macos' | 'linux' | 'unknown';
}
