/**
 * Tests for IMemoryRelationship
 *
 * Tests memory relation types, constants, labels, inverse relations,
 * and the isValidRelationType type guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MEMORY_RELATION_VALUES,
  RELATION_LABELS,
  INVERSE_RELATIONS,
  isValidRelationType,
} from '../../../../../../../src/lib/domain/interfaces/types/IMemoryRelationship';

describe('IMemoryRelationship', () => {
  describe('MEMORY_RELATION_VALUES', () => {
    it('should contain all six relation types', () => {
      assert.deepStrictEqual([...MEMORY_RELATION_VALUES], [
        'supersedes',
        'supports',
        'contradicts',
        'implements',
        'relates_to',
        'refines',
      ]);
    });

    it('should have exactly 6 entries', () => {
      assert.strictEqual(MEMORY_RELATION_VALUES.length, 6);
    });
  });

  describe('RELATION_LABELS', () => {
    it('should have a label for supersedes', () => {
      assert.strictEqual(RELATION_LABELS.supersedes, 'supersedes');
    });

    it('should have a label for supports', () => {
      assert.strictEqual(RELATION_LABELS.supports, 'supports');
    });

    it('should have a label for contradicts', () => {
      assert.strictEqual(RELATION_LABELS.contradicts, 'contradicts');
    });

    it('should have a label for implements', () => {
      assert.strictEqual(RELATION_LABELS.implements, 'implements');
    });

    it('should have a human-friendly label for relates_to', () => {
      assert.strictEqual(RELATION_LABELS.relates_to, 'relates to');
    });

    it('should have a label for refines', () => {
      assert.strictEqual(RELATION_LABELS.refines, 'refines');
    });

    it('should have a label for every value in MEMORY_RELATION_VALUES', () => {
      for (const value of MEMORY_RELATION_VALUES) {
        assert.ok(
          value in RELATION_LABELS,
          `Missing label for relation type: ${value}`
        );
        assert.strictEqual(typeof RELATION_LABELS[value], 'string');
        assert.ok(RELATION_LABELS[value].length > 0, `Empty label for: ${value}`);
      }
    });
  });

  describe('INVERSE_RELATIONS', () => {
    it('should have inverse for supersedes', () => {
      assert.strictEqual(INVERSE_RELATIONS.supersedes, 'superseded by');
    });

    it('should have inverse for supports', () => {
      assert.strictEqual(INVERSE_RELATIONS.supports, 'supported by');
    });

    it('should have inverse for contradicts', () => {
      assert.strictEqual(INVERSE_RELATIONS.contradicts, 'contradicted by');
    });

    it('should have inverse for implements', () => {
      assert.strictEqual(INVERSE_RELATIONS.implements, 'implemented by');
    });

    it('should have inverse for relates_to', () => {
      assert.strictEqual(INVERSE_RELATIONS.relates_to, 'related to');
    });

    it('should have inverse for refines', () => {
      assert.strictEqual(INVERSE_RELATIONS.refines, 'refined by');
    });

    it('should have an inverse for every value in MEMORY_RELATION_VALUES', () => {
      for (const value of MEMORY_RELATION_VALUES) {
        assert.ok(
          value in INVERSE_RELATIONS,
          `Missing inverse for relation type: ${value}`
        );
        assert.strictEqual(typeof INVERSE_RELATIONS[value], 'string');
        assert.ok(INVERSE_RELATIONS[value].length > 0, `Empty inverse for: ${value}`);
      }
    });
  });

  describe('isValidRelationType()', () => {
    it('should return true for supersedes', () => {
      assert.strictEqual(isValidRelationType('supersedes'), true);
    });

    it('should return true for supports', () => {
      assert.strictEqual(isValidRelationType('supports'), true);
    });

    it('should return true for contradicts', () => {
      assert.strictEqual(isValidRelationType('contradicts'), true);
    });

    it('should return true for implements', () => {
      assert.strictEqual(isValidRelationType('implements'), true);
    });

    it('should return true for relates_to', () => {
      assert.strictEqual(isValidRelationType('relates_to'), true);
    });

    it('should return true for refines', () => {
      assert.strictEqual(isValidRelationType('refines'), true);
    });

    it('should return true for all values in MEMORY_RELATION_VALUES', () => {
      for (const value of MEMORY_RELATION_VALUES) {
        assert.strictEqual(isValidRelationType(value), true, `Expected true for: ${value}`);
      }
    });

    it('should return false for invalid values', () => {
      assert.strictEqual(isValidRelationType('replaces'), false);
      assert.strictEqual(isValidRelationType('depends_on'), false);
      assert.strictEqual(isValidRelationType(''), false);
      assert.strictEqual(isValidRelationType('SUPERSEDES'), false);
    });

    it('should return false for partial matches', () => {
      assert.strictEqual(isValidRelationType('super'), false);
      assert.strictEqual(isValidRelationType('supersedes_all'), false);
      assert.strictEqual(isValidRelationType('relates'), false);
    });
  });
});
