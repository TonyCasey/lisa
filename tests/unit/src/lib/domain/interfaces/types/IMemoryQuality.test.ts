/**
 * Tests for IMemoryQuality
 *
 * Tests confidence levels, source types, tag resolution, parsing,
 * score conversion, and default confidence mapping.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CONFIDENCE_VALUES,
  CONFIDENCE_SCORES,
  SOURCE_VALUES,
  DEFAULT_CONFIDENCE,
  resolveConfidenceTag,
  parseConfidenceTag,
  isValidConfidence,
  confidenceToScore,
  scoreToConfidence,
  resolveSourceTag,
  parseSourceTag,
  isValidSource,
  defaultConfidenceForSource,
} from '../../../../../../../src/lib/domain/interfaces/types/IMemoryQuality';

describe('IMemoryQuality', () => {
  describe('CONFIDENCE_VALUES', () => {
    it('should contain all five confidence levels in order', () => {
      assert.deepStrictEqual([...CONFIDENCE_VALUES], [
        'verified',
        'high',
        'medium',
        'low',
        'uncertain',
      ]);
    });
  });

  describe('CONFIDENCE_SCORES', () => {
    it('should map verified to 1.0', () => {
      assert.strictEqual(CONFIDENCE_SCORES.verified, 1.0);
    });

    it('should map high to 0.8', () => {
      assert.strictEqual(CONFIDENCE_SCORES.high, 0.8);
    });

    it('should map medium to 0.5', () => {
      assert.strictEqual(CONFIDENCE_SCORES.medium, 0.5);
    });

    it('should map low to 0.3', () => {
      assert.strictEqual(CONFIDENCE_SCORES.low, 0.3);
    });

    it('should map uncertain to 0.1', () => {
      assert.strictEqual(CONFIDENCE_SCORES.uncertain, 0.1);
    });

    it('should have scores in descending order matching CONFIDENCE_VALUES', () => {
      let previous = Infinity;
      for (const level of CONFIDENCE_VALUES) {
        const score = CONFIDENCE_SCORES[level];
        assert.ok(score < previous, `${level} (${score}) should be less than previous (${previous})`);
        previous = score;
      }
    });
  });

  describe('SOURCE_VALUES', () => {
    it('should contain all six source types', () => {
      assert.deepStrictEqual([...SOURCE_VALUES], [
        'user-explicit',
        'session-capture',
        'prompt-capture',
        'code-analysis',
        'auto-inferred',
        'external-sync',
      ]);
    });
  });

  describe('DEFAULT_CONFIDENCE', () => {
    it('should map user-explicit to high', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['user-explicit'], 'high');
    });

    it('should map session-capture to medium', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['session-capture'], 'medium');
    });

    it('should map prompt-capture to low', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['prompt-capture'], 'low');
    });

    it('should map code-analysis to medium', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['code-analysis'], 'medium');
    });

    it('should map auto-inferred to low', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['auto-inferred'], 'low');
    });

    it('should map external-sync to medium', () => {
      assert.strictEqual(DEFAULT_CONFIDENCE['external-sync'], 'medium');
    });

    it('should have a mapping for every source type', () => {
      for (const source of SOURCE_VALUES) {
        assert.ok(
          DEFAULT_CONFIDENCE[source] !== undefined,
          `Missing default confidence for source: ${source}`
        );
        assert.ok(
          CONFIDENCE_VALUES.includes(DEFAULT_CONFIDENCE[source]),
          `Invalid confidence level for source ${source}: ${DEFAULT_CONFIDENCE[source]}`
        );
      }
    });
  });

  describe('resolveConfidenceTag()', () => {
    it('should return confidence:verified for verified', () => {
      assert.strictEqual(resolveConfidenceTag('verified'), 'confidence:verified');
    });

    it('should return confidence:high for high', () => {
      assert.strictEqual(resolveConfidenceTag('high'), 'confidence:high');
    });

    it('should return confidence:medium for medium', () => {
      assert.strictEqual(resolveConfidenceTag('medium'), 'confidence:medium');
    });

    it('should return confidence:low for low', () => {
      assert.strictEqual(resolveConfidenceTag('low'), 'confidence:low');
    });

    it('should return confidence:uncertain for uncertain', () => {
      assert.strictEqual(resolveConfidenceTag('uncertain'), 'confidence:uncertain');
    });
  });

  describe('parseConfidenceTag()', () => {
    it('should extract verified from tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['type:fact', 'confidence:verified', 'lifecycle:permanent']),
        'verified'
      );
    });

    it('should extract high from tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['confidence:high']),
        'high'
      );
    });

    it('should extract medium from tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['source:session-capture', 'confidence:medium']),
        'medium'
      );
    });

    it('should extract low from tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['confidence:low', 'type:prompt']),
        'low'
      );
    });

    it('should extract uncertain from tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['confidence:uncertain']),
        'uncertain'
      );
    });

    it('should return null when no confidence tag present', () => {
      assert.strictEqual(
        parseConfidenceTag(['type:fact', 'lifecycle:session']),
        null
      );
    });

    it('should return null for empty tags array', () => {
      assert.strictEqual(parseConfidenceTag([]), null);
    });

    it('should ignore invalid confidence values in tags', () => {
      assert.strictEqual(
        parseConfidenceTag(['confidence:invalid', 'confidence:unknown']),
        null
      );
    });

    it('should return first valid confidence when multiple present', () => {
      assert.strictEqual(
        parseConfidenceTag(['confidence:low', 'confidence:high']),
        'low'
      );
    });
  });

  describe('isValidConfidence()', () => {
    it('should return true for verified', () => {
      assert.strictEqual(isValidConfidence('verified'), true);
    });

    it('should return true for high', () => {
      assert.strictEqual(isValidConfidence('high'), true);
    });

    it('should return true for medium', () => {
      assert.strictEqual(isValidConfidence('medium'), true);
    });

    it('should return true for low', () => {
      assert.strictEqual(isValidConfidence('low'), true);
    });

    it('should return true for uncertain', () => {
      assert.strictEqual(isValidConfidence('uncertain'), true);
    });

    it('should return false for invalid values', () => {
      assert.strictEqual(isValidConfidence('invalid'), false);
      assert.strictEqual(isValidConfidence(''), false);
      assert.strictEqual(isValidConfidence('HIGH'), false);
      assert.strictEqual(isValidConfidence('Verified'), false);
    });
  });

  describe('confidenceToScore()', () => {
    it('should return 1.0 for verified', () => {
      assert.strictEqual(confidenceToScore('verified'), 1.0);
    });

    it('should return 0.8 for high', () => {
      assert.strictEqual(confidenceToScore('high'), 0.8);
    });

    it('should return 0.5 for medium', () => {
      assert.strictEqual(confidenceToScore('medium'), 0.5);
    });

    it('should return 0.3 for low', () => {
      assert.strictEqual(confidenceToScore('low'), 0.3);
    });

    it('should return 0.1 for uncertain', () => {
      assert.strictEqual(confidenceToScore('uncertain'), 0.1);
    });
  });

  describe('scoreToConfidence()', () => {
    it('should return verified for 1.0', () => {
      assert.strictEqual(scoreToConfidence(1.0), 'verified');
    });

    it('should return high for 0.8', () => {
      assert.strictEqual(scoreToConfidence(0.8), 'high');
    });

    it('should return medium for 0.5', () => {
      assert.strictEqual(scoreToConfidence(0.5), 'medium');
    });

    it('should return low for 0.3', () => {
      assert.strictEqual(scoreToConfidence(0.3), 'low');
    });

    it('should return uncertain for 0.1', () => {
      assert.strictEqual(scoreToConfidence(0.1), 'uncertain');
    });

    it('should return nearest level for in-between scores', () => {
      // 0.9 is closest to verified (1.0) vs high (0.8)
      assert.strictEqual(scoreToConfidence(0.9), 'verified');
      // 0.65 is closest to high (0.8) vs medium (0.5)
      assert.strictEqual(scoreToConfidence(0.65), 'high');
      // 0.4 is closest to medium (0.5) vs low (0.3)
      assert.strictEqual(scoreToConfidence(0.4), 'medium');
      // 0.2 is closest to low (0.3) vs uncertain (0.1)
      assert.strictEqual(scoreToConfidence(0.2), 'low');
      // 0.05 is closest to uncertain (0.1)
      assert.strictEqual(scoreToConfidence(0.05), 'uncertain');
    });

    it('should clamp scores above 1.0 to verified', () => {
      assert.strictEqual(scoreToConfidence(1.5), 'verified');
      assert.strictEqual(scoreToConfidence(100), 'verified');
    });

    it('should clamp scores below 0.0 to uncertain', () => {
      assert.strictEqual(scoreToConfidence(-0.5), 'uncertain');
      assert.strictEqual(scoreToConfidence(-100), 'uncertain');
    });

    it('should return uncertain for 0.0', () => {
      assert.strictEqual(scoreToConfidence(0.0), 'uncertain');
    });
  });

  describe('resolveSourceTag()', () => {
    it('should return source:user-explicit for user-explicit', () => {
      assert.strictEqual(resolveSourceTag('user-explicit'), 'source:user-explicit');
    });

    it('should return source:session-capture for session-capture', () => {
      assert.strictEqual(resolveSourceTag('session-capture'), 'source:session-capture');
    });

    it('should return source:prompt-capture for prompt-capture', () => {
      assert.strictEqual(resolveSourceTag('prompt-capture'), 'source:prompt-capture');
    });

    it('should return source:code-analysis for code-analysis', () => {
      assert.strictEqual(resolveSourceTag('code-analysis'), 'source:code-analysis');
    });

    it('should return source:auto-inferred for auto-inferred', () => {
      assert.strictEqual(resolveSourceTag('auto-inferred'), 'source:auto-inferred');
    });

    it('should return source:external-sync for external-sync', () => {
      assert.strictEqual(resolveSourceTag('external-sync'), 'source:external-sync');
    });
  });

  describe('parseSourceTag()', () => {
    it('should extract user-explicit from tags', () => {
      assert.strictEqual(
        parseSourceTag(['type:fact', 'source:user-explicit', 'confidence:high']),
        'user-explicit'
      );
    });

    it('should extract session-capture from tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:session-capture']),
        'session-capture'
      );
    });

    it('should extract prompt-capture from tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:prompt-capture', 'lifecycle:ephemeral']),
        'prompt-capture'
      );
    });

    it('should extract code-analysis from tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:code-analysis']),
        'code-analysis'
      );
    });

    it('should extract auto-inferred from tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:auto-inferred']),
        'auto-inferred'
      );
    });

    it('should extract external-sync from tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:external-sync']),
        'external-sync'
      );
    });

    it('should return null when no source tag present', () => {
      assert.strictEqual(
        parseSourceTag(['type:fact', 'confidence:high']),
        null
      );
    });

    it('should return null for empty tags array', () => {
      assert.strictEqual(parseSourceTag([]), null);
    });

    it('should ignore invalid source values in tags', () => {
      assert.strictEqual(
        parseSourceTag(['source:invalid', 'source:unknown']),
        null
      );
    });

    it('should return first valid source when multiple present', () => {
      assert.strictEqual(
        parseSourceTag(['source:session-capture', 'source:user-explicit']),
        'session-capture'
      );
    });
  });

  describe('isValidSource()', () => {
    it('should return true for user-explicit', () => {
      assert.strictEqual(isValidSource('user-explicit'), true);
    });

    it('should return true for session-capture', () => {
      assert.strictEqual(isValidSource('session-capture'), true);
    });

    it('should return true for prompt-capture', () => {
      assert.strictEqual(isValidSource('prompt-capture'), true);
    });

    it('should return true for code-analysis', () => {
      assert.strictEqual(isValidSource('code-analysis'), true);
    });

    it('should return true for auto-inferred', () => {
      assert.strictEqual(isValidSource('auto-inferred'), true);
    });

    it('should return true for external-sync', () => {
      assert.strictEqual(isValidSource('external-sync'), true);
    });

    it('should return false for invalid values', () => {
      assert.strictEqual(isValidSource('invalid'), false);
      assert.strictEqual(isValidSource(''), false);
      assert.strictEqual(isValidSource('USER-EXPLICIT'), false);
      assert.strictEqual(isValidSource('user_explicit'), false);
    });
  });

  describe('defaultConfidenceForSource()', () => {
    it('should return high for user-explicit', () => {
      assert.strictEqual(defaultConfidenceForSource('user-explicit'), 'high');
    });

    it('should return medium for session-capture', () => {
      assert.strictEqual(defaultConfidenceForSource('session-capture'), 'medium');
    });

    it('should return low for prompt-capture', () => {
      assert.strictEqual(defaultConfidenceForSource('prompt-capture'), 'low');
    });

    it('should return medium for code-analysis', () => {
      assert.strictEqual(defaultConfidenceForSource('code-analysis'), 'medium');
    });

    it('should return low for auto-inferred', () => {
      assert.strictEqual(defaultConfidenceForSource('auto-inferred'), 'low');
    });

    it('should return medium for external-sync', () => {
      assert.strictEqual(defaultConfidenceForSource('external-sync'), 'medium');
    });
  });
});
