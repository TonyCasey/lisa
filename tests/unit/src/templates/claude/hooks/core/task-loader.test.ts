/**
 * Tests for Task Loader
 *
 * Tests the pure functions for processing tasks from memory nodes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module (CommonJS style for tsx compatibility)
const {
  getTaskId,
  getTaskNum,
  getTaskStatus,
  getBlockedBy,
  pickLatest,
  memoryItemToTask,
  deduplicateTasks,
  createTaskCounts,
  countTasksByStatus,
  sortTasksByDate,
  filterTasksByStatus,
  processTasks,
  formatTaskCountsSummary,
  formatTask,
  formatTaskList,
} = require('../../../../../../../src/project/.claude/hooks/utils/core/task-loader');

// Type definitions for test clarity
interface IMemoryItem {
  uuid?: string;
  name?: string;
  fact?: string;
  tags?: string[];
  created_at?: string;
}

interface ITask {
  key: string;
  status: string;
  title: string;
  blocked: string[];
  created_at?: string;
}

describe('task-loader', () => {
  // ===========================================================================
  // Tag Extractors
  // ===========================================================================

  describe('getTaskId', () => {
    it('should extract task_id from tags', () => {
      const tags = ['type:task', 'task_id:abc123', 'status:ready'];
      assert.strictEqual(getTaskId(tags), 'abc123');
    });

    it('should return null if no task_id tag', () => {
      const tags = ['type:task', 'status:ready'];
      assert.strictEqual(getTaskId(tags), null);
    });

    it('should return null for empty tags', () => {
      assert.strictEqual(getTaskId([]), null);
      assert.strictEqual(getTaskId(undefined), null);
    });
  });

  describe('getTaskNum', () => {
    it('should extract task_num from tags', () => {
      const tags = ['type:task', 'task_num:5', 'status:ready'];
      assert.strictEqual(getTaskNum(tags), '5');
    });

    it('should return null if no task_num tag', () => {
      const tags = ['type:task', 'status:ready'];
      assert.strictEqual(getTaskNum(tags), null);
    });
  });

  describe('getTaskStatus', () => {
    it('should extract status from tags', () => {
      const tags = ['type:task', 'status:in-progress'];
      assert.strictEqual(getTaskStatus(tags), 'in-progress');
    });

    it('should return unknown for missing status', () => {
      const tags = ['type:task'];
      assert.strictEqual(getTaskStatus(tags), 'unknown');
    });

    it('should lowercase the status', () => {
      const tags = ['status:IN-PROGRESS'];
      assert.strictEqual(getTaskStatus(tags), 'in-progress');
    });
  });

  describe('getBlockedBy', () => {
    it('should extract blocked_by dependencies', () => {
      const tags = ['blocked_by:task-1', 'blocked_by:task-2', 'status:blocked'];
      const result = getBlockedBy(tags);
      assert.deepStrictEqual(result, ['task-1', 'task-2']);
    });

    it('should return empty array if no blocked_by tags', () => {
      const tags = ['status:ready'];
      assert.deepStrictEqual(getBlockedBy(tags), []);
    });
  });

  // ===========================================================================
  // Memory Item Utilities
  // ===========================================================================

  describe('pickLatest', () => {
    it('should pick the item with later timestamp', () => {
      const older: IMemoryItem = { uuid: '1', created_at: '2024-01-01T00:00:00Z' };
      const newer: IMemoryItem = { uuid: '2', created_at: '2024-01-02T00:00:00Z' };

      assert.strictEqual(pickLatest(older, newer), newer);
      assert.strictEqual(pickLatest(newer, older), newer);
    });

    it('should handle missing timestamps', () => {
      const withTimestamp: IMemoryItem = { uuid: '1', created_at: '2024-01-01T00:00:00Z' };
      const withoutTimestamp: IMemoryItem = { uuid: '2' };

      assert.strictEqual(pickLatest(withTimestamp, withoutTimestamp), withTimestamp);
    });

    it('should handle empty objects', () => {
      const result = pickLatest({}, {});
      assert.deepStrictEqual(result, {});
    });
  });

  // ===========================================================================
  // Task Processing
  // ===========================================================================

  describe('memoryItemToTask', () => {
    it('should convert memory item to task', () => {
      const item: IMemoryItem = {
        uuid: '123',
        name: 'Implement feature X',
        tags: ['status:in-progress', 'blocked_by:task-1'],
        created_at: '2024-01-01T00:00:00Z',
      };

      const task = memoryItemToTask('TASK-5', item);

      assert.strictEqual(task.key, 'TASK-5');
      assert.strictEqual(task.status, 'in-progress');
      assert.strictEqual(task.title, 'Implement feature X');
      assert.deepStrictEqual(task.blocked, ['task-1']);
      assert.strictEqual(task.created_at, '2024-01-01T00:00:00Z');
    });

    it('should use fact as title fallback', () => {
      const item: IMemoryItem = {
        fact: 'Some fact text',
        tags: ['status:ready'],
      };

      const task = memoryItemToTask('TASK-1', item);
      assert.strictEqual(task.title, 'Some fact text');
    });

    it('should use uuid as title fallback', () => {
      const item: IMemoryItem = {
        uuid: 'abc-123',
        tags: ['status:ready'],
      };

      const task = memoryItemToTask('TASK-1', item);
      assert.strictEqual(task.title, 'abc-123');
    });
  });

  describe('deduplicateTasks', () => {
    it('should keep latest version of each task', () => {
      const nodes: IMemoryItem[] = [
        { uuid: '1', name: 'Old version', tags: ['task_num:1', 'status:ready'], created_at: '2024-01-01T00:00:00Z' },
        { uuid: '2', name: 'New version', tags: ['task_num:1', 'status:in-progress'], created_at: '2024-01-02T00:00:00Z' },
      ];

      const result = deduplicateTasks(nodes);

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.get('1')?.name, 'New version');
    });

    it('should skip items without task key', () => {
      const nodes: IMemoryItem[] = [
        { uuid: '1', name: 'No key', tags: ['status:ready'] },
        { uuid: '2', name: 'Has key', tags: ['task_num:1', 'status:ready'] },
      ];

      const result = deduplicateTasks(nodes);

      assert.strictEqual(result.size, 1);
      assert.ok(result.has('1'));
    });
  });

  // ===========================================================================
  // Task Counts
  // ===========================================================================

  describe('createTaskCounts', () => {
    it('should create empty counts object', () => {
      const counts = createTaskCounts();

      assert.strictEqual(counts.ready, 0);
      assert.strictEqual(counts['in-progress'], 0);
      assert.strictEqual(counts.blocked, 0);
      assert.strictEqual(counts.done, 0);
      assert.strictEqual(counts.closed, 0);
      assert.strictEqual(counts.unknown, 0);
    });
  });

  describe('countTasksByStatus', () => {
    it('should count tasks by status', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'ready', title: 'Task 1', blocked: [] },
        { key: '2', status: 'ready', title: 'Task 2', blocked: [] },
        { key: '3', status: 'in-progress', title: 'Task 3', blocked: [] },
        { key: '4', status: 'done', title: 'Task 4', blocked: [] },
      ];

      const counts = countTasksByStatus(tasks);

      assert.strictEqual(counts.ready, 2);
      assert.strictEqual(counts['in-progress'], 1);
      assert.strictEqual(counts.done, 1);
      assert.strictEqual(counts.blocked, 0);
    });

    it('should count unknown statuses', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'weird-status', title: 'Task 1', blocked: [] },
      ];

      const counts = countTasksByStatus(tasks);

      assert.strictEqual(counts.unknown, 1);
    });
  });

  // ===========================================================================
  // Sorting and Filtering
  // ===========================================================================

  describe('sortTasksByDate', () => {
    it('should sort tasks by date descending', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'ready', title: 'Oldest', blocked: [], created_at: '2024-01-01T00:00:00Z' },
        { key: '2', status: 'ready', title: 'Newest', blocked: [], created_at: '2024-01-03T00:00:00Z' },
        { key: '3', status: 'ready', title: 'Middle', blocked: [], created_at: '2024-01-02T00:00:00Z' },
      ];

      const sorted = sortTasksByDate(tasks);

      assert.strictEqual(sorted[0].title, 'Newest');
      assert.strictEqual(sorted[1].title, 'Middle');
      assert.strictEqual(sorted[2].title, 'Oldest');
    });

    it('should not mutate original array', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'ready', title: 'A', blocked: [], created_at: '2024-01-01T00:00:00Z' },
        { key: '2', status: 'ready', title: 'B', blocked: [], created_at: '2024-01-02T00:00:00Z' },
      ];

      const sorted = sortTasksByDate(tasks);

      assert.notStrictEqual(sorted, tasks);
      assert.strictEqual(tasks[0].title, 'A');
    });
  });

  describe('filterTasksByStatus', () => {
    it('should filter tasks by status', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'ready', title: 'Task 1', blocked: [] },
        { key: '2', status: 'in-progress', title: 'Task 2', blocked: [] },
        { key: '3', status: 'ready', title: 'Task 3', blocked: [] },
      ];

      const ready = filterTasksByStatus(tasks, 'ready');

      assert.strictEqual(ready.length, 2);
      assert.ok(ready.every((t) => t.status === 'ready'));
    });
  });

  // ===========================================================================
  // Main Processing
  // ===========================================================================

  describe('processTasks', () => {
    it('should process task nodes into summary', () => {
      const nodes: IMemoryItem[] = [
        { uuid: '1', name: 'Task A', tags: ['task_num:1', 'status:ready'], created_at: '2024-01-01T00:00:00Z' },
        { uuid: '2', name: 'Task B', tags: ['task_num:2', 'status:in-progress'], created_at: '2024-01-02T00:00:00Z' },
        { uuid: '3', name: 'Task C', tags: ['task_num:3', 'status:done'], created_at: '2024-01-03T00:00:00Z' },
      ];

      const summary = processTasks(nodes);

      assert.strictEqual(summary.tasks.length, 3);
      assert.strictEqual(summary.counts.ready, 1);
      assert.strictEqual(summary.counts['in-progress'], 1);
      assert.strictEqual(summary.counts.done, 1);
      assert.strictEqual(summary.active.length, 1);
      assert.strictEqual(summary.ready.length, 1);
    });

    it('should handle empty input', () => {
      const summary = processTasks([]);

      assert.strictEqual(summary.tasks.length, 0);
      assert.strictEqual(summary.active.length, 0);
      assert.strictEqual(summary.ready.length, 0);
    });
  });

  // ===========================================================================
  // Formatting
  // ===========================================================================

  describe('formatTaskCountsSummary', () => {
    it('should format counts as summary string', () => {
      const counts = {
        ready: 2,
        'in-progress': 1,
        blocked: 0,
        done: 3,
        closed: 0,
        unknown: 0,
      };

      const result = formatTaskCountsSummary(counts);

      assert.strictEqual(result, '1 in-progress, 2 ready, 3 done');
    });

    it('should return "none active" for empty counts', () => {
      const counts = createTaskCounts();

      const result = formatTaskCountsSummary(counts);

      assert.strictEqual(result, 'none active');
    });
  });

  describe('formatTask', () => {
    it('should format task as "key - title"', () => {
      const task: ITask = { key: 'TASK-5', status: 'ready', title: 'Implement feature', blocked: [] };

      assert.strictEqual(formatTask(task), 'TASK-5 - Implement feature');
    });
  });

  describe('formatTaskList', () => {
    it('should format multiple tasks with separator', () => {
      const tasks: ITask[] = [
        { key: '1', status: 'ready', title: 'Task A', blocked: [] },
        { key: '2', status: 'ready', title: 'Task B', blocked: [] },
        { key: '3', status: 'ready', title: 'Task C', blocked: [] },
      ];

      const result = formatTaskList(tasks, 2);

      assert.strictEqual(result, '1 - Task A | 2 - Task B');
    });
  });
});
