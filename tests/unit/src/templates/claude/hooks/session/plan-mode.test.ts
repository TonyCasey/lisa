/**
 * Tests for Plan Mode
 *
 * Tests the plan mode state management functions.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the module (CommonJS style for tsx compatibility)
const {
  PLAN_MODE_TTL_MS,
  PLAN_MODE_STATE_FILE,
  getPlanModeStatePath,
  readPlanModeState,
  writePlanModeState,
  clearPlanModeState,
  isPlanModeStateExpired,
  shouldLoadPlanContext,
  getPlanModeAge,
} = require('../../../../../../../src/project/.claude/hooks/utils/session/plan-mode');

describe('plan-mode', () => {
  // Create a temp directory for each test
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-mode-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('PLAN_MODE_TTL_MS', () => {
    it('should be 30 minutes', () => {
      assert.strictEqual(PLAN_MODE_TTL_MS, 30 * 60 * 1000);
    });
  });

  describe('PLAN_MODE_STATE_FILE', () => {
    it('should be .plan-mode-state.json', () => {
      assert.strictEqual(PLAN_MODE_STATE_FILE, '.plan-mode-state.json');
    });
  });

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  describe('getPlanModeStatePath', () => {
    it('should return path with state file name', () => {
      const result = getPlanModeStatePath('/some/dir');
      assert.ok(result.endsWith(PLAN_MODE_STATE_FILE));
      assert.ok(result.includes('some'));
    });
  });

  // ===========================================================================
  // State Management
  // ===========================================================================

  describe('readPlanModeState', () => {
    it('should return null if file does not exist', () => {
      const result = readPlanModeState(tempDir);
      assert.strictEqual(result, null);
    });

    it('should read valid state from file', () => {
      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      const state = { loadedAt: '2024-01-15T10:00:00.000Z' };
      fs.writeFileSync(statePath, JSON.stringify(state));

      const result = readPlanModeState(tempDir);

      assert.deepStrictEqual(result, state);
    });

    it('should return null for invalid JSON', () => {
      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      fs.writeFileSync(statePath, 'not valid json');

      const result = readPlanModeState(tempDir);

      assert.strictEqual(result, null);
    });
  });

  describe('writePlanModeState', () => {
    it('should create state file', () => {
      const result = writePlanModeState(tempDir);

      assert.strictEqual(result, true);

      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      assert.ok(fs.existsSync(statePath));
    });

    it('should write valid JSON with loadedAt', () => {
      writePlanModeState(tempDir);

      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      const content = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      assert.ok(content.loadedAt);
      assert.ok(new Date(content.loadedAt).getTime() > 0);
    });

    it('should create directory if needed', () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir');

      const result = writePlanModeState(nestedDir);

      assert.strictEqual(result, true);
      assert.ok(fs.existsSync(nestedDir));
    });
  });

  describe('clearPlanModeState', () => {
    it('should delete state file', () => {
      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      fs.writeFileSync(statePath, '{}');

      const result = clearPlanModeState(tempDir);

      assert.strictEqual(result, true);
      assert.ok(!fs.existsSync(statePath));
    });

    it('should succeed if file does not exist', () => {
      const result = clearPlanModeState(tempDir);

      assert.strictEqual(result, true);
    });
  });

  describe('isPlanModeStateExpired', () => {
    it('should return true for null state', () => {
      assert.strictEqual(isPlanModeStateExpired(null), true);
    });

    it('should return false for recent state', () => {
      const state = { loadedAt: new Date().toISOString() };
      assert.strictEqual(isPlanModeStateExpired(state), false);
    });

    it('should return true for old state', () => {
      const oldDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const state = { loadedAt: oldDate.toISOString() };
      assert.strictEqual(isPlanModeStateExpired(state), true);
    });

    it('should respect custom TTL', () => {
      const state = { loadedAt: new Date(Date.now() - 5000).toISOString() }; // 5 seconds ago

      // With 10 second TTL - not expired
      assert.strictEqual(isPlanModeStateExpired(state, 10000), false);

      // With 3 second TTL - expired
      assert.strictEqual(isPlanModeStateExpired(state, 3000), true);
    });
  });

  // ===========================================================================
  // Main Functions
  // ===========================================================================

  describe('shouldLoadPlanContext', () => {
    it('should return false if not in plan mode', () => {
      const result = shouldLoadPlanContext(false, { devDir: tempDir });
      assert.strictEqual(result, false);
    });

    it('should clear state when not in plan mode', () => {
      // First, create some state
      writePlanModeState(tempDir);
      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      assert.ok(fs.existsSync(statePath));

      // Then call with isPlanMode=false
      shouldLoadPlanContext(false, { devDir: tempDir });

      // State should be cleared
      assert.ok(!fs.existsSync(statePath));
    });

    it('should return true on first entry to plan mode', () => {
      const result = shouldLoadPlanContext(true, { devDir: tempDir });
      assert.strictEqual(result, true);
    });

    it('should return false on subsequent calls within TTL', () => {
      // First call - should return true
      const first = shouldLoadPlanContext(true, { devDir: tempDir });
      assert.strictEqual(first, true);

      // Second call immediately after - should return false
      const second = shouldLoadPlanContext(true, { devDir: tempDir });
      assert.strictEqual(second, false);
    });

    it('should return true after TTL expires', () => {
      // First call
      shouldLoadPlanContext(true, { devDir: tempDir });

      // Manually expire the state
      const statePath = path.join(tempDir, PLAN_MODE_STATE_FILE);
      const oldDate = new Date(Date.now() - PLAN_MODE_TTL_MS - 1000);
      fs.writeFileSync(statePath, JSON.stringify({ loadedAt: oldDate.toISOString() }));

      // Should return true now
      const result = shouldLoadPlanContext(true, { devDir: tempDir });
      assert.strictEqual(result, true);
    });
  });

  describe('getPlanModeAge', () => {
    it('should return null if no state', () => {
      const result = getPlanModeAge({ devDir: tempDir });
      assert.strictEqual(result, null);
    });

    it('should return age in milliseconds', () => {
      writePlanModeState(tempDir);

      // Wait a tiny bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const age = getPlanModeAge({ devDir: tempDir });

      assert.ok(age !== null);
      assert.ok(age >= 0);
      assert.ok(age < 1000); // Should be less than 1 second
    });
  });
});
