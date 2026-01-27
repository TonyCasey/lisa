/**
 * Unit tests for dateParser utility.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseDate,
  getStartOfDay,
  getStartOfToday,
  hoursAgo,
  formatDateForDisplay,
  formatDateRange,
} from '../../../../../src/lib/utils/dateParser';

describe('dateParser', () => {
  describe('parseDate', () => {
    it('should return null for null input', () => {
      assert.strictEqual(parseDate(null as unknown as string), null);
    });

    it('should return null for undefined input', () => {
      assert.strictEqual(parseDate(undefined as unknown as string), null);
    });

    it('should return null for empty string', () => {
      assert.strictEqual(parseDate(''), null);
    });

    it('should parse "today" as start of today', () => {
      const result = parseDate('today');
      assert.ok(result instanceof Date);
      
      const now = new Date();
      const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      assert.strictEqual(result!.getTime(), expected.getTime());
    });

    it('should parse "yesterday" as start of yesterday', () => {
      const result = parseDate('yesterday');
      assert.ok(result instanceof Date);
      
      const now = new Date();
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      assert.strictEqual(result!.getTime(), yesterday.getTime());
    });

    it('should parse "7d" as 7 days ago', () => {
      const before = Date.now();
      const result = parseDate('7d');
      const after = Date.now();
      
      assert.ok(result instanceof Date);
      const expected = new Date();
      expected.setDate(expected.getDate() - 7);
      
      // Allow for slight timing differences
      const diff = Math.abs(result!.getTime() - expected.getTime());
      assert.ok(diff < 1000); // Less than 1 second difference
    });

    it('should parse "1w" as 7 days ago', () => {
      const result = parseDate('1w');
      assert.ok(result instanceof Date);
      
      const expected = new Date();
      expected.setDate(expected.getDate() - 7);
      
      const diff = Math.abs(result!.getTime() - expected.getTime());
      assert.ok(diff < 1000);
    });

    it('should parse "24h" as 24 hours ago', () => {
      const result = parseDate('24h');
      assert.ok(result instanceof Date);
      
      const expected = new Date();
      expected.setHours(expected.getHours() - 24);
      
      const diff = Math.abs(result!.getTime() - expected.getTime());
      assert.ok(diff < 1000);
    });

    it('should parse "1m" as 1 month ago', () => {
      const result = parseDate('1m');
      assert.ok(result instanceof Date);
      
      const expected = new Date();
      expected.setMonth(expected.getMonth() - 1);
      
      const diff = Math.abs(result!.getTime() - expected.getTime());
      assert.ok(diff < 60000); // Less than 1 minute difference
    });

    it('should parse ISO date string', () => {
      const result = parseDate('2026-01-27');
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getFullYear(), 2026);
      // Note: month is 0-indexed in getMonth()
      assert.strictEqual(result!.getMonth(), 0);
      assert.strictEqual(result!.getDate(), 27);
    });

    it('should parse ISO datetime string', () => {
      const result = parseDate('2026-01-27T10:30:00Z');
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.toISOString(), '2026-01-27T10:30:00.000Z');
    });

    it('should be case-insensitive for relative dates', () => {
      const todayLower = parseDate('today');
      const todayUpper = parseDate('TODAY');
      const todayMixed = parseDate('Today');
      
      assert.ok(todayLower instanceof Date);
      assert.ok(todayUpper instanceof Date);
      assert.ok(todayMixed instanceof Date);
      
      assert.strictEqual(todayLower!.getTime(), todayUpper!.getTime());
      assert.strictEqual(todayLower!.getTime(), todayMixed!.getTime());
    });

    it('should return null for invalid date strings', () => {
      assert.strictEqual(parseDate('invalid'), null);
      assert.strictEqual(parseDate('not-a-date'), null);
      assert.strictEqual(parseDate('abc123'), null);
    });
  });

  describe('getStartOfDay', () => {
    it('should return midnight for a given date', () => {
      const date = new Date('2026-01-27T15:30:45.123Z');
      const result = getStartOfDay(date);
      
      assert.strictEqual(result.getHours(), 0);
      assert.strictEqual(result.getMinutes(), 0);
      assert.strictEqual(result.getSeconds(), 0);
      assert.strictEqual(result.getMilliseconds(), 0);
    });

    it('should not modify the original date', () => {
      const original = new Date('2026-01-27T15:30:45.123Z');
      const originalTime = original.getTime();
      
      getStartOfDay(original);
      
      assert.strictEqual(original.getTime(), originalTime);
    });
  });

  describe('getStartOfToday', () => {
    it('should return midnight today', () => {
      const result = getStartOfToday();
      const now = new Date();
      
      assert.strictEqual(result.getFullYear(), now.getFullYear());
      assert.strictEqual(result.getMonth(), now.getMonth());
      assert.strictEqual(result.getDate(), now.getDate());
      assert.strictEqual(result.getHours(), 0);
      assert.strictEqual(result.getMinutes(), 0);
      assert.strictEqual(result.getSeconds(), 0);
    });
  });

  describe('hoursAgo', () => {
    it('should return a date N hours ago', () => {
      const result = hoursAgo(2);
      const expected = Date.now() - 2 * 60 * 60 * 1000;
      
      const diff = Math.abs(result.getTime() - expected);
      assert.ok(diff < 100); // Less than 100ms difference
    });

    it('should handle 0 hours', () => {
      const result = hoursAgo(0);
      const diff = Math.abs(result.getTime() - Date.now());
      assert.ok(diff < 100);
    });
  });

  describe('formatDateForDisplay', () => {
    it('should format date in current year without year', () => {
      const now = new Date();
      const date = new Date(now.getFullYear(), 5, 15); // June 15 of current year
      const result = formatDateForDisplay(date);
      
      assert.strictEqual(result, 'Jun 15');
    });

    it('should format date in different year with year', () => {
      const now = new Date();
      const pastYear = now.getFullYear() - 1;
      const date = new Date(pastYear, 5, 15); // June 15 of last year
      const result = formatDateForDisplay(date);
      
      assert.strictEqual(result, `Jun 15, ${pastYear}`);
    });
  });

  describe('formatDateRange', () => {
    it('should format a date range', () => {
      const now = new Date();
      const since = new Date(now.getFullYear(), 5, 10);
      const until = new Date(now.getFullYear(), 5, 15);
      
      const result = formatDateRange(since, until);
      assert.strictEqual(result, 'Jun 10 - Jun 15');
    });

    it('should return single date when since equals until', () => {
      const now = new Date();
      const date = new Date(now.getFullYear(), 5, 15);
      
      const result = formatDateRange(date, date);
      assert.strictEqual(result, 'Jun 15');
    });

    it('should default to now for until parameter', () => {
      const now = new Date();
      const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
      
      const result = formatDateRange(since);
      // Result should include today
      assert.ok(result.includes('-'));
    });
  });
});
