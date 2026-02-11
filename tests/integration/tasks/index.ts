/**
 * Tasks Skill Integration Tests
 *
 * Tests tasks skill I/O contracts against git-mem backend.
 *
 * Enable by setting environment variable:
 *   RUN_GITMEM_INTEGRATION_TESTS=1
 *
 * Optional overrides:
 *   TASKS_TEST_GROUP_ID=<custom-group>
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  addTask,
  listTasks,
  runTasksSmokeSuite,
  checkGitMemReady,
  tasksScriptExists,
} from './tasks-cli-client';
import {
  createTestGitRepo,
  cleanupTestGitRepo,
  isGitMemAvailable,
} from '../shared/test-repo-utils';

// =============================================================================
// Test Configuration
// =============================================================================

const runMode = process.env.RUN_GITMEM_INTEGRATION_TESTS;
const tasksTestsEnabled = runMode === '1';
const baseGroupId =
  process.env.TASKS_TEST_GROUP_ID || `lisa-tasks-it-${Date.now()}`;

// =============================================================================
// Test Suite
// =============================================================================

if (!tasksTestsEnabled) {
  test.skip(
    'Tasks integration tests disabled. Set RUN_GITMEM_INTEGRATION_TESTS=1 to enable.',
    () => {}
  );
} else if (!tasksScriptExists) {
  test.skip(
    'Tasks script not found. Run `npm run build` or `lisa init` first.',
    () => {}
  );
} else {
  describe('tasks skill integration (git-mem)', () => {
    let testRepoPath: string;
    let gitMemAvailable = false;

    before(async () => {
      // Check if git-mem CLI is available
      gitMemAvailable = await isGitMemAvailable();
      if (!gitMemAvailable) {
        throw new Error('git-mem CLI not found. Install with: npm install -g git-mem');
      }

      // Create isolated test git repository
      testRepoPath = await createTestGitRepo('lisa-gitmem-tasks');

      // Verify git-mem is working in test repo
      const status = await checkGitMemReady({
        testRepoPath,
        groupId: `${baseGroupId}-probe`,
      });
      if (!status.ok) {
        throw status.error || new Error('git-mem not ready in test repository');
      }
    });

    after(async () => {
      // Clean up test repository
      if (testRepoPath) {
        await cleanupTestGitRepo(testRepoPath);
      }
    });

    // =========================================================================
    // I/O Contract Tests (from SKILL.md)
    // =========================================================================

    describe('I/O contract validation', () => {
      test(
        'add returns correct I/O contract shape',
        { timeout: 30_000 },
        async () => {
          const title = `Contract test ${randomUUID()}`;
          const result = await addTask(title, {
            testRepoPath,
            groupId: `${baseGroupId}-contract`,
            status: 'todo',
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'add', 'action should be "add"');
          assert.ok(result.task, 'task object should be present');
          assert.equal(result.task.title, title, 'task title should match input');
          assert.equal(result.task.status, 'todo', 'task status should match input');
          assert.ok(result.group, 'group should be present');
        }
      );

      test(
        'list returns correct I/O contract shape',
        { timeout: 30_000 },
        async () => {
          const result = await listTasks({
            testRepoPath,
            groupId: `${baseGroupId}-contract`,
            limit: 5,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'list', 'action should be "list"');
          assert.ok(Array.isArray(result.tasks), 'tasks should be an array');
          assert.ok(result.group || result.groups, 'group(s) should be present');
        }
      );
    });

    // =========================================================================
    // Persistence Tests
    // =========================================================================

    describe('persistence', () => {
      test(
        'saves and lists task within the same group',
        { timeout: 30_000 },
        async () => {
          const groupId = `${baseGroupId}-save-list`;
          const uniqueId = randomUUID().slice(0, 8);
          const uniqueTitle = `Implement user authentication for project ${uniqueId}`;

          // Add task
          const addResult = await addTask(uniqueTitle, {
            testRepoPath,
            groupId,
            status: 'todo',
          });
          assert.equal(addResult.status, 'ok');
          assert.equal(addResult.task.title, uniqueTitle);

          // git-mem is synchronous - no delay needed

          // List and verify
          const listResult = await listTasks({
            testRepoPath,
            groupId,
            limit: 25,
          });

          const found = listResult.tasks.some((task) =>
            task.title.includes(uniqueId)
          );
          assert.ok(
            found,
            `Added task should be found via list (got ${listResult.tasks.length} tasks)`
          );
        }
      );
    });

    // =========================================================================
    // Status Tests
    // =========================================================================

    describe('task statuses', () => {
      test(
        'supports todo status',
        { timeout: 30_000 },
        async () => {
          const title = `Status todo ${randomUUID()}`;
          const result = await addTask(title, {
            testRepoPath,
            groupId: `${baseGroupId}-status`,
            status: 'todo',
          });
          assert.equal(result.task.status, 'todo', 'Task status should be "todo"');
        }
      );

      test(
        'supports doing status',
        { timeout: 30_000 },
        async () => {
          const title = `Status doing ${randomUUID()}`;
          const result = await addTask(title, {
            testRepoPath,
            groupId: `${baseGroupId}-status`,
            status: 'doing',
          });
          assert.equal(result.task.status, 'doing', 'Task status should be "doing"');
        }
      );

      test(
        'supports done status',
        { timeout: 30_000 },
        async () => {
          const title = `Status done ${randomUUID()}`;
          const result = await addTask(title, {
            testRepoPath,
            groupId: `${baseGroupId}-status`,
            status: 'done',
          });
          assert.equal(result.task.status, 'done', 'Task status should be "done"');
        }
      );
    });

    // =========================================================================
    // Group Isolation Tests
    // =========================================================================

    describe('group isolation', () => {
      test(
        'tasks remain isolated across distinct groups',
        { timeout: 30_000 },
        async () => {
          const sourceGroup = `${baseGroupId}-isolation-src`;
          const isolationGroup = `${baseGroupId}-isolation-dst`;
          const uniqueTitle = `Isolation test ${randomUUID()}`;

          // Add to source group
          await addTask(uniqueTitle, {
            testRepoPath,
            groupId: sourceGroup,
            status: 'todo',
          });

          // git-mem is synchronous - no delay needed

          // List from isolation group (should NOT find the task)
          const isolationList = await listTasks({
            testRepoPath,
            groupId: isolationGroup,
            limit: 20,
          });
          const leaked = isolationList.tasks.some((task) =>
            task.title.includes(uniqueTitle)
          );
          assert.ok(!leaked, 'Task should not leak into different group');
        }
      );
    });

    // =========================================================================
    // Tag Tests
    // =========================================================================

    describe('tags', () => {
      test(
        'preserves explicit tag when adding task',
        { timeout: 30_000 },
        async () => {
          const result = await addTask(`Tagged task ${randomUUID()}`, {
            testRepoPath,
            groupId: `${baseGroupId}-tags`,
            status: 'todo',
            tag: 'feature',
          });

          assert.equal(result.task.tag, 'feature', 'Tag should be preserved');
        }
      );
    });

    // =========================================================================
    // Smoke Suite
    // =========================================================================

    describe('smoke suite', () => {
      test(
        'confirms persistence and isolation',
        { timeout: 30_000 },
        async () => {
          const suiteResult = await runTasksSmokeSuite({
            testRepoPath,
            groupId: `${baseGroupId}-suite`,
            isolationGroupId: `${baseGroupId}-suite-alt`,
          });

          assert.equal(suiteResult.addResponse.status, 'ok');
          assert.ok(suiteResult.taskFound, 'Smoke suite should find added task');
          assert.ok(
            !suiteResult.isolationLeaked,
            'Smoke suite should not detect leakage'
          );
        }
      );
    });
  });
}
