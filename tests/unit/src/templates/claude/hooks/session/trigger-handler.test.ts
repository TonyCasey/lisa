/**
 * Tests for Trigger Handler
 *
 * Tests the pure functions for handling session start trigger types.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module (CommonJS style for tsx compatibility)
const {
  getTriggerMessage,
  getTriggerReminders,
  getTriggerLabel,
  formatTriggerLabel,
  VALID_TRIGGERS,
  isValidTrigger,
  parseTrigger,
  isContextResetTrigger,
  isFreshStartTrigger,
  isResumeTrigger,
} = require('../../../../../../../src/project/.claude/hooks/utils/session/trigger-handler');

describe('trigger-handler', () => {
  // ===========================================================================
  // Trigger Messages
  // ===========================================================================

  describe('getTriggerMessage', () => {
    it('should return startup message', () => {
      const result = getTriggerMessage('startup');
      assert.strictEqual(result, 'Memory loaded for session start.');
    });

    it('should return resume message', () => {
      const result = getTriggerMessage('resume');
      assert.strictEqual(result, 'Memory loaded for session resume.');
    });

    it('should return compact message', () => {
      const result = getTriggerMessage('compact');
      assert.strictEqual(result, 'Memory reloaded after context compaction.');
    });

    it('should return clear message', () => {
      const result = getTriggerMessage('clear');
      assert.strictEqual(result, 'Memory loaded after context clear.');
    });

    it('should return default message for unknown trigger', () => {
      const result = getTriggerMessage('unknown');
      assert.strictEqual(result, 'Memory loaded for session start.');
    });
  });

  describe('getTriggerReminders', () => {
    it('should return empty array for startup', () => {
      const result = getTriggerReminders('startup');
      assert.deepStrictEqual(result, []);
    });

    it('should return empty array for resume', () => {
      const result = getTriggerReminders('resume');
      assert.deepStrictEqual(result, []);
    });

    it('should return reminder for compact', () => {
      const result = getTriggerReminders('compact');
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('compacted'));
      assert.ok(result[0].includes('skills'));
    });

    it('should return reminder for clear', () => {
      const result = getTriggerReminders('clear');
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('cleared'));
      assert.ok(result[0].includes('/memory'));
    });
  });

  // ===========================================================================
  // Trigger Labels
  // ===========================================================================

  describe('getTriggerLabel', () => {
    it('should return empty string for startup', () => {
      assert.strictEqual(getTriggerLabel('startup'), '');
    });

    it('should return trigger name for other types', () => {
      assert.strictEqual(getTriggerLabel('resume'), 'resume');
      assert.strictEqual(getTriggerLabel('compact'), 'compact');
      assert.strictEqual(getTriggerLabel('clear'), 'clear');
    });
  });

  describe('formatTriggerLabel', () => {
    it('should return empty string for startup', () => {
      assert.strictEqual(formatTriggerLabel('startup'), '');
    });

    it('should return label in parentheses for other types', () => {
      assert.strictEqual(formatTriggerLabel('resume'), ' (resume)');
      assert.strictEqual(formatTriggerLabel('compact'), ' (compact)');
      assert.strictEqual(formatTriggerLabel('clear'), ' (clear)');
    });
  });

  // ===========================================================================
  // Trigger Validation
  // ===========================================================================

  describe('VALID_TRIGGERS', () => {
    it('should contain all valid trigger types', () => {
      assert.ok(VALID_TRIGGERS.includes('startup'));
      assert.ok(VALID_TRIGGERS.includes('resume'));
      assert.ok(VALID_TRIGGERS.includes('compact'));
      assert.ok(VALID_TRIGGERS.includes('clear'));
      assert.strictEqual(VALID_TRIGGERS.length, 4);
    });
  });

  describe('isValidTrigger', () => {
    it('should return true for valid triggers', () => {
      assert.strictEqual(isValidTrigger('startup'), true);
      assert.strictEqual(isValidTrigger('resume'), true);
      assert.strictEqual(isValidTrigger('compact'), true);
      assert.strictEqual(isValidTrigger('clear'), true);
    });

    it('should return false for invalid triggers', () => {
      assert.strictEqual(isValidTrigger('invalid'), false);
      assert.strictEqual(isValidTrigger(''), false);
      assert.strictEqual(isValidTrigger(undefined), false);
    });
  });

  describe('parseTrigger', () => {
    it('should parse valid trigger', () => {
      assert.strictEqual(parseTrigger('resume'), 'resume');
    });

    it('should fall back to session_type', () => {
      assert.strictEqual(parseTrigger(undefined, 'compact'), 'compact');
    });

    it('should prefer trigger over session_type', () => {
      assert.strictEqual(parseTrigger('resume', 'compact'), 'resume');
    });

    it('should default to startup for invalid input', () => {
      assert.strictEqual(parseTrigger('invalid'), 'startup');
      assert.strictEqual(parseTrigger(undefined, undefined), 'startup');
      assert.strictEqual(parseTrigger(), 'startup');
    });
  });

  // ===========================================================================
  // Context Checks
  // ===========================================================================

  describe('isContextResetTrigger', () => {
    it('should return true for compact and clear', () => {
      assert.strictEqual(isContextResetTrigger('compact'), true);
      assert.strictEqual(isContextResetTrigger('clear'), true);
    });

    it('should return false for startup and resume', () => {
      assert.strictEqual(isContextResetTrigger('startup'), false);
      assert.strictEqual(isContextResetTrigger('resume'), false);
    });
  });

  describe('isFreshStartTrigger', () => {
    it('should return true for startup and clear', () => {
      assert.strictEqual(isFreshStartTrigger('startup'), true);
      assert.strictEqual(isFreshStartTrigger('clear'), true);
    });

    it('should return false for resume and compact', () => {
      assert.strictEqual(isFreshStartTrigger('resume'), false);
      assert.strictEqual(isFreshStartTrigger('compact'), false);
    });
  });

  describe('isResumeTrigger', () => {
    it('should return true for resume and compact', () => {
      assert.strictEqual(isResumeTrigger('resume'), true);
      assert.strictEqual(isResumeTrigger('compact'), true);
    });

    it('should return false for startup and clear', () => {
      assert.strictEqual(isResumeTrigger('startup'), false);
      assert.strictEqual(isResumeTrigger('clear'), false);
    });
  });
});
