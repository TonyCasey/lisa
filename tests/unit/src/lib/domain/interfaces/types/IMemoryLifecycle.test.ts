/**
 * Tests for IMemoryLifecycle
 *
 * Tests lifecycle types, tag resolution, parsing, and expiration computation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  LIFECYCLE_VALUES,
  LIFECYCLE_DEFAULTS,
  resolveLifecycleTag,
  parseLifecycleTag,
  isValidLifecycle,
  computeExpiresAt,
} from '../../../../../../../src/lib/domain/interfaces/types/IMemoryLifecycle';

describe('IMemoryLifecycle', () => {
  describe('LIFECYCLE_VALUES', () => {
    it('should contain all four lifecycle tiers', () => {
      assert.deepStrictEqual([...LIFECYCLE_VALUES], [
        'permanent',
        'project',
        'session',
        'ephemeral',
      ]);
    });
  });

  describe('LIFECYCLE_DEFAULTS', () => {
    it('should have null TTL for permanent', () => {
      assert.strictEqual(LIFECYCLE_DEFAULTS.permanent, null);
    });

    it('should have null TTL for project', () => {
      assert.strictEqual(LIFECYCLE_DEFAULTS.project, null);
    });

    it('should have 24h TTL for session', () => {
      assert.strictEqual(LIFECYCLE_DEFAULTS.session, 24 * 60 * 60 * 1000);
    });

    it('should have 1h TTL for ephemeral', () => {
      assert.strictEqual(LIFECYCLE_DEFAULTS.ephemeral, 60 * 60 * 1000);
    });
  });

  describe('resolveLifecycleTag()', () => {
    it('should return lifecycle:permanent for permanent', () => {
      assert.strictEqual(resolveLifecycleTag('permanent'), 'lifecycle:permanent');
    });

    it('should return lifecycle:project for project', () => {
      assert.strictEqual(resolveLifecycleTag('project'), 'lifecycle:project');
    });

    it('should return lifecycle:session for session', () => {
      assert.strictEqual(resolveLifecycleTag('session'), 'lifecycle:session');
    });

    it('should return lifecycle:ephemeral for ephemeral', () => {
      assert.strictEqual(resolveLifecycleTag('ephemeral'), 'lifecycle:ephemeral');
    });
  });

  describe('parseLifecycleTag()', () => {
    it('should extract permanent from tags', () => {
      assert.strictEqual(
        parseLifecycleTag(['type:fact', 'lifecycle:permanent', 'source:user']),
        'permanent'
      );
    });

    it('should extract session from tags', () => {
      assert.strictEqual(
        parseLifecycleTag(['lifecycle:session']),
        'session'
      );
    });

    it('should extract ephemeral from tags', () => {
      assert.strictEqual(
        parseLifecycleTag(['lifecycle:ephemeral', 'type:prompt']),
        'ephemeral'
      );
    });

    it('should default to project when no lifecycle tag present', () => {
      assert.strictEqual(
        parseLifecycleTag(['type:fact', 'source:user']),
        'project'
      );
    });

    it('should default to project for empty tags array', () => {
      assert.strictEqual(parseLifecycleTag([]), 'project');
    });

    it('should ignore invalid lifecycle values in tags', () => {
      assert.strictEqual(
        parseLifecycleTag(['lifecycle:invalid', 'lifecycle:unknown']),
        'project'
      );
    });

    it('should return first valid lifecycle when multiple present', () => {
      assert.strictEqual(
        parseLifecycleTag(['lifecycle:session', 'lifecycle:permanent']),
        'session'
      );
    });
  });

  describe('isValidLifecycle()', () => {
    it('should return true for permanent', () => {
      assert.strictEqual(isValidLifecycle('permanent'), true);
    });

    it('should return true for project', () => {
      assert.strictEqual(isValidLifecycle('project'), true);
    });

    it('should return true for session', () => {
      assert.strictEqual(isValidLifecycle('session'), true);
    });

    it('should return true for ephemeral', () => {
      assert.strictEqual(isValidLifecycle('ephemeral'), true);
    });

    it('should return false for invalid values', () => {
      assert.strictEqual(isValidLifecycle('temporary'), false);
      assert.strictEqual(isValidLifecycle(''), false);
      assert.strictEqual(isValidLifecycle('PERMANENT'), false);
    });
  });

  describe('computeExpiresAt()', () => {
    const now = new Date('2026-01-31T12:00:00.000Z');

    it('should return null for permanent lifecycle', () => {
      assert.strictEqual(computeExpiresAt('permanent', undefined, now), null);
    });

    it('should return null for project lifecycle', () => {
      assert.strictEqual(computeExpiresAt('project', undefined, now), null);
    });

    it('should return now + 24h for session lifecycle', () => {
      const result = computeExpiresAt('session', undefined, now);
      assert.ok(result);
      const expected = new Date('2026-02-01T12:00:00.000Z');
      assert.strictEqual(result.getTime(), expected.getTime());
    });

    it('should return now + 1h for ephemeral lifecycle', () => {
      const result = computeExpiresAt('ephemeral', undefined, now);
      assert.ok(result);
      const expected = new Date('2026-01-31T13:00:00.000Z');
      assert.strictEqual(result.getTime(), expected.getTime());
    });

    it('should use custom TTL when provided', () => {
      const customTtl = 2 * 60 * 60 * 1000; // 2 hours
      const result = computeExpiresAt('session', customTtl, now);
      assert.ok(result);
      const expected = new Date('2026-01-31T14:00:00.000Z');
      assert.strictEqual(result.getTime(), expected.getTime());
    });

    it('should override null TTL with custom TTL for permanent', () => {
      const customTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
      const result = computeExpiresAt('permanent', customTtl, now);
      assert.ok(result);
      const expected = new Date('2026-02-07T12:00:00.000Z');
      assert.strictEqual(result.getTime(), expected.getTime());
    });

    it('should use current time when now is not provided', () => {
      const before = Date.now();
      const result = computeExpiresAt('ephemeral');
      const after = Date.now();
      assert.ok(result);
      // Result should be approximately 1 hour from now
      const oneHour = 60 * 60 * 1000;
      assert.ok(result.getTime() >= before + oneHour);
      assert.ok(result.getTime() <= after + oneHour);
    });
  });
});
