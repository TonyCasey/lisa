/**
 * Memory Skill Integration Tests
 *
 * Tests memory skill I/O contracts against real backend (local MCP or Zep Cloud).
 *
 * Enable by setting environment variables:
 *   RUN_MEMORY_INTEGRATION_TESTS=1
 *   STORAGE_MODE=zep-cloud (or 'local' for Docker MCP)
 *
 * ZEP_API_KEY is loaded automatically from root .env file.
 *
 * Optional overrides:
 *   MEMORY_TEST_GROUP_ID=<custom-group>
 *   MEMORY_TEST_ENDPOINT=<custom-endpoint>
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  addMemory,
  loadMemory,
  runMemorySmokeSuite,
  checkMemoryEndpoint,
  memoryScriptExists,
} from './memory-cli-client';

// =============================================================================
// Test Configuration
// =============================================================================

const runMode = process.env.RUN_MEMORY_INTEGRATION_TESTS;
const memoryTestsEnabled = runMode === '1';
const storageMode = process.env.STORAGE_MODE || 'local';
const isZepCloud = storageMode === 'zep-cloud';
const baseGroupId =
  process.env.MEMORY_TEST_GROUP_ID || `lisa-memory-it-${Date.now()}`;
const endpointOverride = process.env.MEMORY_TEST_ENDPOINT;

// =============================================================================
// Test Suite
// =============================================================================

if (!memoryTestsEnabled) {
  test.skip(
    'Memory integration tests disabled. Set RUN_MEMORY_INTEGRATION_TESTS=1 to enable.',
    () => {}
  );
} else if (!memoryScriptExists) {
  test.skip(
    'Memory script not found. Run `npm run build` or `lisa init` first.',
    () => {}
  );
} else {
  describe(`memory skill integration (${storageMode})`, () => {
    let backendReady = false;
    let backendError: Error | undefined;

    before(async () => {
      const status = await checkMemoryEndpoint({
        endpoint: endpointOverride,
        groupId: `${baseGroupId}-probe`,
      });
      backendReady = status.ok;
      backendError = status.error;
      if (!backendReady) {
        throw backendError || new Error(`Memory backend unavailable (${storageMode})`);
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
            endpoint: endpointOverride,
            groupId: `${baseGroupId}-contract`,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'add', 'action should be "add"');
          assert.ok(result.group, 'group should be present');
          assert.equal(result.text, text, 'text should match input');

          if (isZepCloud) {
            assert.equal(result.mode, 'zep-cloud', 'mode should be "zep-cloud"');
          }
        }
      );

      test(
        'load returns correct I/O contract shape',
        { timeout: 30_000 },
        async () => {
          const result = await loadMemory({
            endpoint: endpointOverride,
            groupId: `${baseGroupId}-contract`,
            limit: 5,
          });

          // Verify I/O contract (from SKILL.md)
          assert.equal(result.status, 'ok', 'status should be "ok"');
          assert.equal(result.action, 'load', 'action should be "load"');
          assert.ok(result.group || result.groups, 'group(s) should be present');
          assert.ok(Array.isArray(result.facts), 'facts should be an array');

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
        'saves and loads memory within the same group',
        { timeout: 60_000 },
        async () => {
          const groupId = `${baseGroupId}-save-load`;
          const uniqueText = `Memory test ${randomUUID()}`;

          // Add memory
          const addResult = await addMemory(uniqueText, {
            endpoint: endpointOverride,
            groupId,
          });
          assert.equal(addResult.status, 'ok');
          assert.equal(addResult.text, uniqueText);

          // Wait for eventual consistency (Zep processes asynchronously)
          await delay(isZepCloud ? 10000 : 2000);

          // Load and verify
          const loadResult = await loadMemory({
            endpoint: endpointOverride,
            groupId,
            limit: 25,
          });

          if (isZepCloud) {
            // Zep Cloud transforms content via LLM fact extraction,
            // so we verify facts exist rather than exact text match
            assert.ok(
              loadResult.facts.length >= 1,
              'Group should have facts after add operation'
            );
          } else {
            // Local MCP preserves exact text
            const found = loadResult.facts.some((fact) =>
              (fact.fact || fact.name || '').includes(uniqueText)
            );
            assert.ok(found, 'Added memory should be found via load');
          }
        }
      );
    });

    // =========================================================================
    // Group Isolation Tests
    // =========================================================================

    describe('group isolation', () => {
      test(
        'memories remain isolated across distinct groups',
        { timeout: 60_000 },
        async () => {
          const sourceGroup = `${baseGroupId}-isolation-src`;
          const isolationGroup = `${baseGroupId}-isolation-dst`;
          const uniqueText = `Isolation test ${randomUUID()}`;

          // Add to source group
          await addMemory(uniqueText, {
            endpoint: endpointOverride,
            groupId: sourceGroup,
          });
          await delay(isZepCloud ? 10000 : 2000);

          // Load from isolation group (should NOT find the memory)
          const isolationLoad = await loadMemory({
            endpoint: endpointOverride,
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
            endpoint: endpointOverride,
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
              endpoint: endpointOverride,
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
            endpoint: endpointOverride,
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
        { timeout: 120_000 },
        async () => {
          const suiteResult = await runMemorySmokeSuite({
            endpoint: endpointOverride,
            groupId: `${baseGroupId}-suite`,
            isolationGroupId: `${baseGroupId}-suite-alt`,
          });

          assert.equal(suiteResult.addResponse.status, 'ok');

          if (isZepCloud) {
            // Zep Cloud transforms content via LLM fact extraction,
            // so we verify facts exist rather than exact text match
            assert.ok(
              suiteResult.loadResponse.facts.length >= 1,
              'Should have facts in group after add operation'
            );
          } else {
            // Local MCP preserves exact text
            assert.ok(suiteResult.primaryFound, 'Smoke suite should find added memory');
          }

          assert.ok(
            !suiteResult.isolationLeaked,
            'Smoke suite should not detect leakage'
          );
        }
      );
    });
  });
}
