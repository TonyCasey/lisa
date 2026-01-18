/**
 * Tests for Output Formatter
 *
 * Tests the pure functions for formatting memory output and dates.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module (CommonJS style for tsx compatibility)
const {
  formatRelativeDate,
  filterRecentMemories,
  extractGroupSummary,
  groupMemoriesByTime,
  formatMemorySummary,
  formatUserSummary,
  EXCLUDED_RELATIONSHIPS,
} = require('../../../../../../../src/project/.claude/hooks/utils/io/output-formatter');

// Type definitions for test clarity
interface IMemoryItem {
  uuid?: string;
  name?: string;
  fact?: string;
  tags?: string[];
  created_at?: string;
}

describe('output-formatter', () => {
  // ===========================================================================
  // Date Formatting
  // ===========================================================================

  describe('formatRelativeDate', () => {
    it('should format today\'s date with "Today"', () => {
      const now = new Date();
      const result = formatRelativeDate(now);
      assert.ok(result.startsWith('Today '));
    });

    it('should format yesterday\'s date with "Yesterday"', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = formatRelativeDate(yesterday);
      assert.ok(result.startsWith('Yesterday '));
    });

    it('should format older dates with month and day', () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = formatRelativeDate(oldDate);
      // Should NOT start with Today or Yesterday
      assert.ok(!result.startsWith('Today '));
      assert.ok(!result.startsWith('Yesterday '));
      // Should contain time
      assert.ok(/\d{2}:\d{2}/.test(result));
    });

    it('should include time in 24-hour format', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = formatRelativeDate(date);
      assert.ok(result.includes('14:30'));
    });
  });

  // ===========================================================================
  // Memory Filtering
  // ===========================================================================

  describe('filterRecentMemories', () => {
    it('should filter out memories without timestamps', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Has timestamp', created_at: new Date().toISOString() },
        { uuid: '2', fact: 'No timestamp' },
      ];

      const result = filterRecentMemories(memories, 24);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, '1');
    });

    it('should filter out memories older than cutoff', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
      const old = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Recent', created_at: recent.toISOString() },
        { uuid: '2', fact: 'Old', created_at: old.toISOString() },
      ];

      const result = filterRecentMemories(memories, 24);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, '1');
    });

    it('should filter out excluded relationship types', () => {
      const now = new Date().toISOString();
      const memories: IMemoryItem[] = [
        { uuid: '1', name: 'USER_SUBMITS_DIRECTION', fact: 'noise', created_at: now },
        { uuid: '2', name: 'NORMAL_RELATIONSHIP', fact: 'good', created_at: now },
      ];

      const result = filterRecentMemories(memories, 24);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, '2');
    });

    it('should return empty array for empty input', () => {
      const result = filterRecentMemories([], 24);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('EXCLUDED_RELATIONSHIPS', () => {
    it('should contain known noise types', () => {
      assert.ok(EXCLUDED_RELATIONSHIPS.has('USER_SUBMITS_DIRECTION'));
      assert.ok(EXCLUDED_RELATIONSHIPS.has('DIRECTION_IS_TOPIC'));
      assert.ok(EXCLUDED_RELATIONSHIPS.has('TESTS'));
    });
  });

  // ===========================================================================
  // Memory Grouping
  // ===========================================================================

  describe('extractGroupSummary', () => {
    it('should return fact for single memory', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Single fact here' },
      ];

      const result = extractGroupSummary(memories);

      assert.strictEqual(result, 'Single fact here');
    });

    it('should return name if no fact', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1', name: 'Memory name' },
      ];

      const result = extractGroupSummary(memories);

      assert.strictEqual(result, 'Memory name');
    });

    it('should find common prefix for multiple memories', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Implemented feature for the parser module' },
        { uuid: '2', fact: 'Implemented feature for the lexer module' },
        { uuid: '3', fact: 'Implemented feature for the formatter' },
      ];

      const result = extractGroupSummary(memories);

      // Common prefix "Implemented feature for" is > 15 chars
      assert.ok(result.includes('Implemented feature'));
      assert.ok(result.includes('3 items'));
    });

    it('should truncate long first fact when no common prefix', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'A very long fact that should be truncated because it exceeds the maximum length allowed' },
        { uuid: '2', fact: 'Completely different fact here' },
      ];

      const result = extractGroupSummary(memories);

      assert.ok(result.includes('...'));
      assert.ok(result.includes('+1 more'));
    });

    it('should return item count for empty facts', () => {
      const memories: IMemoryItem[] = [
        { uuid: '1' },
        { uuid: '2' },
      ];

      const result = extractGroupSummary(memories);

      assert.strictEqual(result, '2 items');
    });
  });

  describe('groupMemoriesByTime', () => {
    it('should return empty array for empty input', () => {
      const result = groupMemoriesByTime([]);
      assert.deepStrictEqual(result, []);
    });

    it('should group memories within time window', () => {
      const base = Date.now();
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Fact 1', created_at: new Date(base).toISOString() },
        { uuid: '2', fact: 'Fact 2', created_at: new Date(base - 2 * 60 * 1000).toISOString() }, // 2 min earlier
        { uuid: '3', fact: 'Fact 3', created_at: new Date(base - 10 * 60 * 1000).toISOString() }, // 10 min earlier
      ];

      const result = groupMemoriesByTime(memories, 5); // 5 min window

      assert.strictEqual(result.length, 2); // Two groups
      assert.strictEqual(result[0].memories.length, 2); // First group has 2
      assert.strictEqual(result[1].memories.length, 1); // Second group has 1
    });

    it('should sort groups by most recent first', () => {
      const base = Date.now();
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Old', created_at: new Date(base - 60 * 60 * 1000).toISOString() },
        { uuid: '2', fact: 'New', created_at: new Date(base).toISOString() },
      ];

      const result = groupMemoriesByTime(memories, 5);

      assert.strictEqual(result[0].memories[0].fact, 'New');
    });
  });

  describe('formatMemorySummary', () => {
    it('should format memory groups as lines', () => {
      const base = Date.now();
      const memories: IMemoryItem[] = [
        { uuid: '1', fact: 'Did something', created_at: new Date(base).toISOString() },
      ];

      const result = formatMemorySummary(memories, 5);

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('Did something'));
      assert.ok(result[0].startsWith('  ')); // Indented
    });

    it('should limit number of groups', () => {
      const base = Date.now();
      const memories: IMemoryItem[] = [];
      // Create 10 memories, each 10 minutes apart (different groups)
      for (let i = 0; i < 10; i++) {
        memories.push({
          uuid: String(i),
          fact: `Fact ${i}`,
          created_at: new Date(base - i * 10 * 60 * 1000).toISOString(),
        });
      }

      const result = formatMemorySummary(memories, 3);

      assert.strictEqual(result.length, 3);
    });

    it('should return empty array for empty input', () => {
      const result = formatMemorySummary([]);
      assert.deepStrictEqual(result, []);
    });
  });

  // ===========================================================================
  // User Summary
  // ===========================================================================

  describe('formatUserSummary', () => {
    it('should format with memory and task counts', () => {
      const result = formatUserSummary(5, 3, false, '');

      assert.strictEqual(result, '[Memory loaded: 5 memories, 3 tasks]');
    });

    it('should show "no prior context" when both counts are 0', () => {
      const result = formatUserSummary(0, 0, false, '');

      assert.strictEqual(result, '[Memory loaded: no prior context]');
    });

    it('should append "(partial)" when timed out', () => {
      const result = formatUserSummary(2, 1, true, '');

      assert.ok(result.includes('(partial)'));
    });

    it('should include trigger label', () => {
      const result = formatUserSummary(5, 3, false, ' (resume)');

      assert.ok(result.includes('(resume)'));
    });
  });
});
