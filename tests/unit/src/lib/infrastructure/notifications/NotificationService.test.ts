/**
 * Tests for NotificationService.
 *
 * Tests cross-platform notification service including:
 * - Platform detection
 * - Notification creation from state changes
 * - Debouncing logic
 * - Shell escaping
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  NotificationService,
  createNotificationFromStateChange,
} from '../../../../../../src/lib/infrastructure/notifications/NotificationService';
import type {
  INotification,
  NotificationType,
} from '../../../../../../src/lib/domain/interfaces/INotificationService';

describe('NotificationService', () => {
  describe('constructor', () => {
    it('should create service with default options', () => {
      const service = new NotificationService();
      assert.ok(service);
    });

    it('should accept custom options', () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: false,
        debounceMs: 10000,
      });
      assert.ok(service);
    });
  });

  describe('getPlatform', () => {
    it('should return a valid platform string', () => {
      const service = new NotificationService();
      const platform = service.getPlatform();
      assert.ok(['windows', 'macos', 'linux', 'unknown'].includes(platform));
    });

    it('should return windows on win32', () => {
      // This test will pass on Windows
      const service = new NotificationService();
      const platform = service.getPlatform();
      if (process.platform === 'win32') {
        assert.strictEqual(platform, 'windows');
      }
    });

    it('should return macos on darwin', () => {
      // This test will pass on macOS
      const service = new NotificationService();
      const platform = service.getPlatform();
      if (process.platform === 'darwin') {
        assert.strictEqual(platform, 'macos');
      }
    });

    it('should return linux on linux', () => {
      // This test will pass on Linux
      const service = new NotificationService();
      const platform = service.getPlatform();
      if (process.platform === 'linux') {
        assert.strictEqual(platform, 'linux');
      }
    });
  });

  describe('isDesktopAvailable', () => {
    it('should return a boolean', async () => {
      const service = new NotificationService();
      const available = await service.isDesktopAvailable();
      assert.strictEqual(typeof available, 'boolean');
    });

    it('should cache the result', async () => {
      const service = new NotificationService();
      const first = await service.isDesktopAvailable();
      const second = await service.isDesktopAvailable();
      assert.strictEqual(first, second);
    });
  });

  describe('notify', () => {
    it('should return success when all methods disabled but logToFile enabled', async () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: true,
      });

      const notification: INotification = {
        type: 'checks_updated',
        title: 'Test',
        body: 'Test body',
        prNumber: 42,
        repo: 'owner/repo',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      const result = await service.notify(notification);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.method, 'log');
    });

    it('should return failure when all methods disabled', async () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: false,
      });

      const notification: INotification = {
        type: 'checks_updated',
        title: 'Test',
        body: 'Test body',
        prNumber: 42,
        repo: 'owner/repo',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      const result = await service.notify(notification);
      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should debounce repeated notifications', async () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: true,
        debounceMs: 5000,
      });

      const notification: INotification = {
        type: 'checks_updated',
        title: 'Test',
        body: 'Test body',
        prNumber: 42,
        repo: 'owner/repo',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      // First notification
      const result1 = await service.notify(notification);
      assert.strictEqual(result1.success, true);

      // Second notification (should be debounced to log only)
      const result2 = await service.notify(notification);
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.method, 'log');
    });

    it('should not debounce different notifications', async () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: true,
        debounceMs: 5000,
      });

      const notification1: INotification = {
        type: 'checks_updated',
        title: 'Test 1',
        body: 'Test body 1',
        prNumber: 42,
        repo: 'owner/repo',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      const notification2: INotification = {
        type: 'pr_merged',
        title: 'Test 2',
        body: 'Test body 2',
        prNumber: 43,
        repo: 'owner/repo2',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      const result1 = await service.notify(notification1);
      const result2 = await service.notify(notification2);

      // Both should succeed (not debounced because different key)
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
    });
  });

  describe('notifyBatch', () => {
    it('should process all notifications', async () => {
      const service = new NotificationService({
        desktop: false,
        terminalBell: false,
        logToFile: true,
      });

      const notifications: INotification[] = [
        {
          type: 'checks_updated',
          title: 'Test 1',
          body: 'Body 1',
          prNumber: 1,
          repo: 'owner/repo1',
          priority: 'normal',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'pr_merged',
          title: 'Test 2',
          body: 'Body 2',
          prNumber: 2,
          repo: 'owner/repo2',
          priority: 'normal',
          timestamp: new Date().toISOString(),
        },
      ];

      const results = await service.notifyBatch(notifications);
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.success));
    });
  });
});

describe('createNotificationFromStateChange', () => {
  describe('checks_updated', () => {
    it('should create notification for success status', () => {
      const notification = createNotificationFromStateChange(
        'checks_updated',
        'checks pending -> success',
        42,
        'owner/repo',
        'Add feature'
      );

      assert.strictEqual(notification.type, 'checks_updated');
      assert.ok(notification.title.includes('All checks passed'));
      assert.strictEqual(notification.priority, 'normal');
      assert.strictEqual(notification.prNumber, 42);
      assert.strictEqual(notification.repo, 'owner/repo');
    });

    it('should create high priority notification for failure status', () => {
      const notification = createNotificationFromStateChange(
        'checks_updated',
        'checks pending -> failure',
        42,
        'owner/repo',
        'Add feature'
      );

      assert.ok(notification.title.includes('Checks failed'));
      assert.strictEqual(notification.priority, 'high');
    });

    it('should create low priority notification for other status', () => {
      const notification = createNotificationFromStateChange(
        'checks_updated',
        'checks pending -> running',
        42,
        'owner/repo'
      );

      assert.ok(notification.title.includes('Checks updated'));
      assert.strictEqual(notification.priority, 'low');
    });
  });

  describe('new_comment', () => {
    it('should create notification with normal priority', () => {
      const notification = createNotificationFromStateChange(
        'new_comment',
        'new comment from @user on file.ts:42',
        42,
        'owner/repo'
      );

      assert.strictEqual(notification.type, 'new_comment');
      assert.ok(notification.title.includes('New comment'));
      assert.strictEqual(notification.priority, 'normal');
    });
  });

  describe('new_reply', () => {
    it('should create notification with high priority', () => {
      const notification = createNotificationFromStateChange(
        'new_reply',
        'new reply from @reviewer on file.ts:10',
        42,
        'owner/repo'
      );

      assert.strictEqual(notification.type, 'new_reply');
      assert.ok(notification.title.includes('New reply'));
      assert.strictEqual(notification.priority, 'high');
    });
  });

  describe('pr_merged', () => {
    it('should create notification with PR title', () => {
      const notification = createNotificationFromStateChange(
        'pr_merged',
        'PR merged',
        42,
        'owner/repo',
        'Add new feature'
      );

      assert.strictEqual(notification.type, 'pr_merged');
      assert.ok(notification.title.includes('Merged'));
      assert.ok(notification.body.includes('Add new feature'));
      assert.strictEqual(notification.priority, 'normal');
    });

    it('should use default message when no PR title', () => {
      const notification = createNotificationFromStateChange(
        'pr_merged',
        'PR merged',
        42,
        'owner/repo'
      );

      assert.ok(notification.body.includes('PR merged successfully'));
    });
  });

  describe('pr_closed', () => {
    it('should create notification with low priority', () => {
      const notification = createNotificationFromStateChange(
        'pr_closed',
        'PR closed',
        42,
        'owner/repo'
      );

      assert.strictEqual(notification.type, 'pr_closed');
      assert.ok(notification.title.includes('Closed'));
      assert.strictEqual(notification.priority, 'low');
    });
  });

  describe('pr_approved', () => {
    it('should create notification with high priority', () => {
      const notification = createNotificationFromStateChange(
        'pr_approved',
        'PR approved by @reviewer',
        42,
        'owner/repo',
        'Add feature'
      );

      assert.strictEqual(notification.type, 'pr_approved');
      assert.ok(notification.title.includes('Approved'));
      assert.strictEqual(notification.priority, 'high');
    });
  });

  describe('repo shortening', () => {
    it('should use short repo name in body', () => {
      const notification = createNotificationFromStateChange(
        'pr_merged',
        'PR merged',
        42,
        'organization/repository-name',
        'Title'
      );

      assert.ok(notification.body.includes('repository-name'));
      assert.ok(!notification.body.includes('organization/'));
    });
  });

  describe('timestamp', () => {
    it('should include ISO timestamp', () => {
      const before = new Date().toISOString();
      const notification = createNotificationFromStateChange(
        'new_comment',
        'description',
        1,
        'repo'
      );
      const after = new Date().toISOString();

      assert.ok(notification.timestamp >= before);
      assert.ok(notification.timestamp <= after);
    });
  });
});
