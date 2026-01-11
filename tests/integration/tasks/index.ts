/**
 * Tasks Skill Integration Tests
 *
 * Tests tasks skill I/O contracts against real backend (local MCP or Zep Cloud).
 *
 * Enable by setting environment variables:
 *   RUN_TASKS_INTEGRATION_TESTS=1
 *   STORAGE_MODE=zep-cloud (or 'local' for Docker MCP)
 *
 * ZEP_API_KEY is loaded automatically from root .env file.
 *
 * Optional overrides:
 *   TASKS_TEST_GROUP_ID=<custom-group>
 *   TASKS_TEST_ENDPOINT=<custom-endpoint>
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  addTask,
  listTasks,
  runTasksSmokeSuite,
  checkTasksEndpoint,
  tasksScriptExists,
} from './tasks-cli-client';

// =============================================================================
// Test Configuration
// =============================================================================

const runMode = process.env.RUN_TASKS_INTEGRATION_TESTS;
const tasksTestsEnabled = runMode === '1';
const storageMode = process.env.STORAGE_MODE || 'local';
const isZepCloud = storageMode === 'zep-cloud';
const baseGroupId =
  process.env.TASKS_TEST_GROUP_ID || `lisa-tasks-it-${Date.now()}`;
const endpointOverride = process.env.TASKS_TEST_ENDPOINT;

// =============================================================================
// Test Suite
// =============================================================================

if (!tasksTestsEnabled) {
  test.skip(
    'Tasks integration tests disabled. Set RUN_TASKS_INTEGRATION_TESTS=1 to enable.',
    () => {}
  );
} else if (!tasksScriptExists) {
  test.skip(
    'Tasks script not found. Run `npm run build` or `lisa init` first.',
    () => {}
  );
} else {
  describe(`tasks skill integration (${storageMode})`, () => {
    let backendReady = false;
    let backendError: Error | undefined;

    before(async () => {
      const status = await checkTasksEndpoint({
        endpoint: endpointOverride,
        groupId: `${baseGroupId}-probe`,
      });
      backendReady = status.ok;
      backendError = status.error;
      if (!backendReady) {
        throw backendError || new Error(`Tasks backend unavailable (${storageMode})`);
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
            endpoint: endpointOverride,
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

          if (isZepCloud) {
            assert.equal(result.mode, 'zep-cloud', 'mode should be "zep-cloud"');
          }
        }
      );

      test(
        'list returns correct I/O contract shape',
        { timeout: 30_000 },
        async () => {
          const result = await listTasks({
            endpoint: endpointOverride,
            groupId: `${baseGroupId}-contract`,
            limit: 5,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'list', 'action should be "list"');
          assert.ok(Array.isArray(result.tasks), 'tasks should be an array');
          assert.ok(result.group || result.groups, 'group(s) should be present');

          if (isZepCloud) {
            assert.equal(result.mode, 'zep-cloud', 'mode should be "zep-cloud"');
          }
        }
      );
    });

    // =========================================================================
    // Persistence Tests
    // =========================================================================

    describe('persistence', () => {
      test(
        'saves and lists task within the same group',
        { timeout: 60_000 },
        async () => {
          const groupId = `${baseGroupId}-save-list`;
          const uniqueTitle = `Task test ${randomUUID()}`;

          // Add task
          const addResult = await addTask(uniqueTitle, {
            endpoint: endpointOverride,
            groupId,
            status: 'todo',
          });
          assert.equal(addResult.status, 'ok');
          assert.equal(addResult.task.title, uniqueTitle);

          // Wait for eventual consistency
          await delay(2000);

          // List and verify
          const listResult = await listTasks({
            endpoint: endpointOverride,
            groupId,
            limit: 25,
          });
          const found = listResult.tasks.some((task) =>
            task.title.includes(uniqueTitle)
          );
          assert.ok(found, 'Added task should be found via list');
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
            endpoint: endpointOverride,
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
            endpoint: endpointOverride,
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
            endpoint: endpointOverride,
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
        { timeout: 60_000 },
        async () => {
          const sourceGroup = `${baseGroupId}-isolation-src`;
          const isolationGroup = `${baseGroupId}-isolation-dst`;
          const uniqueTitle = `Isolation test ${randomUUID()}`;

          // Add to source group
          await addTask(uniqueTitle, {
            endpoint: endpointOverride,
            groupId: sourceGroup,
            status: 'todo',
          });
          await delay(2000);

          // List from isolation group (should NOT find the task)
          const isolationList = await listTasks({
            endpoint: endpointOverride,
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
            endpoint: endpointOverride,
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
        { timeout: 60_000 },
        async () => {
          const suiteResult = await runTasksSmokeSuite({
            endpoint: endpointOverride,
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
