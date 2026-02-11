/**
 * Memory Skill Integration Tests
 *
 * Tests memory skill I/O contracts against git-mem backend.
 *
 * Enable by setting environment variable:
 *   RUN_GITMEM_INTEGRATION_TESTS=1
 *
 * Optional overrides:
 *   MEMORY_TEST_GROUP_ID=<custom-group>
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  addMemory,
  loadMemory,
  runMemorySmokeSuite,
  checkGitMemReady,
  memoryScriptExists,
} from './memory-cli-client';
import {
  createTestGitRepo,
  cleanupTestGitRepo,
  isGitMemAvailable,
} from '../shared/test-repo-utils';

// =============================================================================
// Test Configuration
// =============================================================================

const runMode = process.env.RUN_GITMEM_INTEGRATION_TESTS;
const memoryTestsEnabled = runMode === '1';
const baseGroupId =
  process.env.MEMORY_TEST_GROUP_ID || `lisa-memory-it-${Date.now()}`;

// =============================================================================
// Test Suite
// =============================================================================

if (!memoryTestsEnabled) {
  test.skip(
    'Memory integration tests disabled. Set RUN_GITMEM_INTEGRATION_TESTS=1 to enable.',
    () => {}
  );
} else if (!memoryScriptExists) {
  test.skip(
    'Memory script not found. Run `npm run build` or `lisa init` first.',
    () => {}
  );
} else {
  describe('memory skill integration (git-mem)', () => {
    let testRepoPath: string;
    let gitMemAvailable = false;

    before(async () => {
      // Check if git-mem CLI is available
      gitMemAvailable = await isGitMemAvailable();
      if (!gitMemAvailable) {
        throw new Error('git-mem CLI not found. Install with: npm install -g git-mem');
      }

      // Create isolated test git repository
      testRepoPath = await createTestGitRepo('lisa-gitmem-memory');

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
          const text = `Contract test ${randomUUID()}`;
          const result = await addMemory(text, {
            testRepoPath,
            groupId: `${baseGroupId}-contract`,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'add', 'action should be "add"');
          assert.ok(result.group, 'group should be present');
          assert.equal(result.text, text, 'text should match input');
        }
      );

      test(
        'load returns correct I/O contract shape',
        { timeout: 30_000 },
        async () => {
          const result = await loadMemory({
            testRepoPath,
            groupId: `${baseGroupId}-contract`,
            limit: 5,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'load', 'action should be "load"');
          assert.ok(result.group || result.groups, 'group(s) should be present');
          assert.ok(Array.isArray(result.facts), 'facts should be an array');
        }
      );
    });

    // =========================================================================
    // Persistence Tests
    // =========================================================================

    describe('persistence', () => {
      test(
        'saves and loads memory within the same group',
        { timeout: 30_000 },
        async () => {
          const groupId = `${baseGroupId}-save-load`;
          const uniqueId = randomUUID().slice(0, 8);
          const uniqueText = `DECISION: We decided to use PostgreSQL for project ${uniqueId} because it provides better JSON support and reliability`;

          // Add memory
          const addResult = await addMemory(uniqueText, {
            testRepoPath,
            groupId,
          });
          assert.equal(addResult.status, 'ok');
          assert.equal(addResult.text, uniqueText);

          // git-mem is synchronous - no delay needed

          // Load and verify
          const loadResult = await loadMemory({
            testRepoPath,
            groupId,
            limit: 25,
          });

          // git-mem stores raw content - verify facts exist
          assert.ok(
            loadResult.facts.length >= 1,
            `Group should have facts after add operation (got ${loadResult.facts.length} facts)`
          );

          // Verify the content is retrievable
          const found = loadResult.facts.some(
            (fact) => (fact.fact || fact.name || '').includes(uniqueId)
          );
          assert.ok(found, 'Added memory should be retrievable');
        }
      );
    });

    // =========================================================================
    // Group Isolation Tests
    // =========================================================================

    describe('group isolation', () => {
      test(
        'memories remain isolated across distinct groups',
        { timeout: 30_000 },
        async () => {
          const sourceGroup = `${baseGroupId}-isolation-src`;
          const isolationGroup = `${baseGroupId}-isolation-dst`;
          const uniqueText = `Isolation test ${randomUUID()}`;

          // Add to source group
          await addMemory(uniqueText, {
            testRepoPath,
            groupId: sourceGroup,
          });

          // git-mem is synchronous - no delay needed

          // Load from isolation group (should NOT find the memory)
          const isolationLoad = await loadMemory({
            testRepoPath,
            groupId: isolationGroup,
            limit: 20,
          });
          const leaked = isolationLoad.facts.some((fact) =>
            (fact.fact || fact.name || '').includes(uniqueText)
          );
          assert.ok(!leaked, 'Memory should not leak into different group');
        }
      );
    });

    // =========================================================================
    // Tag Tests
    // =========================================================================

    describe('tags', () => {
      test(
        'preserves explicit tag when adding memory',
        { timeout: 30_000 },
        async () => {
          const result = await addMemory(`Tagged memory ${randomUUID()}`, {
            testRepoPath,
            groupId: `${baseGroupId}-tags`,
            tag: 'code:decision',
          });

          assert.equal(result.tag, 'code:decision', 'Tag should be preserved');
        }
      );

      test(
        'auto-detects tag from DECISION: prefix',
        { timeout: 30_000 },
        async () => {
          const result = await addMemory(
            `DECISION: Use TypeScript ${randomUUID()}`,
            {
              testRepoPath,
              groupId: `${baseGroupId}-tags`,
            }
          );

          assert.equal(
            result.tag,
            'code:decision',
            'Tag should be auto-detected from DECISION: prefix'
          );
        }
      );

      test(
        'auto-detects tag from BUG: prefix',
        { timeout: 30_000 },
        async () => {
          const result = await addMemory(`BUG: Found null pointer ${randomUUID()}`, {
            testRepoPath,
            groupId: `${baseGroupId}-tags`,
          });

          assert.equal(
            result.tag,
            'context:bug',
            'Tag should be auto-detected from BUG: prefix'
          );
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
          const suiteResult = await runMemorySmokeSuite({
            testRepoPath,
            groupId: `${baseGroupId}-suite`,
            isolationGroupId: `${baseGroupId}-suite-alt`,
          });

          assert.equal(suiteResult.addResponse.status, 'ok');

          // git-mem stores raw content - verify memory is found
          assert.ok(suiteResult.primaryFound, 'Smoke suite should find added memory');

          assert.ok(
            !suiteResult.isolationLeaked,
            'Smoke suite should not detect leakage'
          );
        }
      );
    });
  });
}
