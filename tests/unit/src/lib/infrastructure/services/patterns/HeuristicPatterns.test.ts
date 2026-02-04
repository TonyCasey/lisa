import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractPatternMatches,
  extractByFactType,
  DECISION_PATTERNS,
  GOTCHA_PATTERNS,
  CONVENTION_PATTERNS,
  ALL_PATTERNS,
} from '../../../../../../../src/lib/infrastructure/services/patterns/HeuristicPatterns';

describe('HeuristicPatterns', () => {
  describe('extractPatternMatches', () => {
    it('should return empty array for empty text', () => {
      const matches = extractPatternMatches('');
      assert.deepStrictEqual(matches, []);
    });

    it('should return empty array for null/undefined text', () => {
      const matches = extractPatternMatches(null as unknown as string);
      assert.deepStrictEqual(matches, []);
    });

    it('should return empty array for whitespace-only text', () => {
      const matches = extractPatternMatches('   \n\t  ');
      assert.deepStrictEqual(matches, []);
    });

    it('should extract decision patterns with "because" keyword', () => {
      const text = 'We did this because it improves performance significantly.';
      const matches = extractPatternMatches(text);

      assert.ok(matches.length > 0, 'Should find at least one match');
      const decisionMatch = matches.find(m => m.factType === 'decision');
      assert.ok(decisionMatch, 'Should find a decision fact');
      assert.strictEqual(decisionMatch.patternName, 'because-clause');
    });

    it('should extract decision patterns with "instead of" keyword', () => {
      const text = 'We used Redis instead of Memcached for better persistence.';
      const matches = extractPatternMatches(text);

      const decisionMatch = matches.find(m => m.patternName === 'instead-of');
      assert.ok(decisionMatch, 'Should find an instead-of pattern');
      assert.strictEqual(decisionMatch.factType, 'decision');
    });

    it('should extract decision patterns with "decided to" keyword', () => {
      const text = 'We decided to use TypeScript for better type safety.';
      const matches = extractPatternMatches(text);

      const decisionMatch = matches.find(m => m.patternName === 'decided-to');
      assert.ok(decisionMatch, 'Should find a decided-to pattern');
    });

    it('should extract gotcha patterns with "careful" keyword', () => {
      const text = 'Careful: this function mutates the input array.';
      const matches = extractPatternMatches(text);

      const gotchaMatch = matches.find(m => m.factType === 'gotcha');
      assert.ok(gotchaMatch, 'Should find a gotcha fact');
      assert.strictEqual(gotchaMatch.patternName, 'careful');
    });

    it('should extract gotcha patterns with "workaround" keyword', () => {
      const text = 'Workaround: we had to bypass the cache for this edge case.';
      const matches = extractPatternMatches(text);

      const gotchaMatch = matches.find(m => m.patternName === 'workaround');
      assert.ok(gotchaMatch, 'Should find a workaround pattern');
    });

    it('should extract gotcha patterns with "breaking change" keyword', () => {
      const text = 'Breaking change: the API response format has changed.';
      const matches = extractPatternMatches(text);

      const gotchaMatch = matches.find(m => m.patternName === 'breaking-change');
      assert.ok(gotchaMatch, 'Should find a breaking-change pattern');
    });

    it('should extract convention patterns with "always" keyword', () => {
      const text = 'Always use async/await instead of raw promises.';
      const matches = extractPatternMatches(text);

      const conventionMatch = matches.find(m => m.factType === 'convention');
      assert.ok(conventionMatch, 'Should find a convention fact');
    });

    it('should extract convention patterns with "never" keyword', () => {
      const text = 'Never commit credentials to the repository.';
      const matches = extractPatternMatches(text);

      const conventionMatch = matches.find(m => m.patternName === 'never');
      assert.ok(conventionMatch, 'Should find a never pattern');
    });

    it('should extract convention patterns with "prefer" keyword', () => {
      const text = 'Prefer composition over inheritance for better flexibility.';
      const matches = extractPatternMatches(text);

      const conventionMatch = matches.find(m => m.patternName === 'prefer');
      assert.ok(conventionMatch, 'Should find a prefer pattern');
    });

    it('should extract multiple patterns from the same text', () => {
      const text = `
        We decided to use GraphQL because it provides better flexibility.
        Careful: the resolver must handle null values.
        Always validate input before processing.
      `;
      const matches = extractPatternMatches(text);

      const types = matches.map(m => m.factType);
      assert.ok(types.includes('decision'), 'Should find decision');
      assert.ok(types.includes('gotcha'), 'Should find gotcha');
      assert.ok(types.includes('convention'), 'Should find convention');
    });

    it('should not extract patterns that are too short', () => {
      const text = 'Because yes.';  // Too short
      const matches = extractPatternMatches(text);

      assert.strictEqual(matches.length, 0, 'Should not match very short text');
    });

    it('should deduplicate identical matches', () => {
      const text = 'Because it is faster. Because it is faster.';
      const matches = extractPatternMatches(text);

      // Should only have one match despite duplicate text
      const uniqueTexts = new Set(matches.map(m => m.text.toLowerCase()));
      assert.strictEqual(uniqueTexts.size, matches.length, 'Should not have duplicates');
    });

    it('should set confidence based on match length', () => {
      // Short text that meets minimum length but is relatively short
      const shortText = 'Careful: handle null inputs carefully.';
      // Long text that should get higher confidence
      const longText = 'Careful: you need to handle null values carefully because the database may return undefined for optional fields and this can cause runtime errors.';

      const shortMatches = extractPatternMatches(shortText);
      const longMatches = extractPatternMatches(longText);

      // Both should extract something
      assert.ok(shortMatches.length > 0, 'Expected a short match');
      assert.ok(longMatches.length > 0, 'Expected a long match');

      // Long matches (>100 chars) should have higher confidence than short (<30 chars)
      // The 'careful' pattern has baseConfidence 'high', but short text downgrades it
      // Long text (>100 chars) maintains or upgrades confidence
      const shortConfidence = shortMatches[0].confidence;
      const longConfidence = longMatches[0].confidence;

      // Long text should have equal or higher confidence
      const confidenceOrder = { low: 0, medium: 1, high: 2 };
      assert.ok(
        confidenceOrder[longConfidence] >= confidenceOrder[shortConfidence],
        `Expected long text confidence (${longConfidence}) >= short text confidence (${shortConfidence})`
      );
    });

    it('should extract ## Why sections from PR templates', () => {
      const text = `
## Why

This change improves performance by reducing database queries from N+1 to a single batch query.

## How
      `;
      const matches = extractPatternMatches(text, DECISION_PATTERNS);

      const whyMatch = matches.find(m => m.patternName === 'why-section');
      assert.ok(whyMatch, 'Should find a why-section pattern');
      assert.ok(whyMatch.text.includes('improves performance'), 'Should capture the content');
    });
  });

  describe('extractByFactType', () => {
    it('should only extract patterns of the specified type', () => {
      const text = `
        We decided to use TypeScript because it provides type safety.
        Careful: this is a gotcha.
        Always follow this convention.
      `;

      const decisionMatches = extractByFactType(text, 'decision');
      const gotchaMatches = extractByFactType(text, 'gotcha');
      const conventionMatches = extractByFactType(text, 'convention');

      assert.ok(decisionMatches.every(m => m.factType === 'decision'));
      assert.ok(gotchaMatches.every(m => m.factType === 'gotcha'));
      assert.ok(conventionMatches.every(m => m.factType === 'convention'));
    });
  });

  describe('pattern definitions', () => {
    it('should have DECISION_PATTERNS defined', () => {
      assert.ok(Array.isArray(DECISION_PATTERNS));
      assert.ok(DECISION_PATTERNS.length > 0);
    });

    it('should have GOTCHA_PATTERNS defined', () => {
      assert.ok(Array.isArray(GOTCHA_PATTERNS));
      assert.ok(GOTCHA_PATTERNS.length > 0);
    });

    it('should have CONVENTION_PATTERNS defined', () => {
      assert.ok(Array.isArray(CONVENTION_PATTERNS));
      assert.ok(CONVENTION_PATTERNS.length > 0);
    });

    it('should have ALL_PATTERNS as combination of all patterns', () => {
      assert.ok(Array.isArray(ALL_PATTERNS));
      assert.strictEqual(
        ALL_PATTERNS.length,
        DECISION_PATTERNS.length + GOTCHA_PATTERNS.length + CONVENTION_PATTERNS.length
      );
    });

    it('should have valid pattern definitions', () => {
      for (const pattern of ALL_PATTERNS) {
        assert.ok(pattern.pattern instanceof RegExp, 'Pattern should be a RegExp');
        assert.ok(['decision', 'gotcha', 'convention'].includes(pattern.factType), 'Invalid factType');
        assert.ok(typeof pattern.name === 'string', 'Name should be a string');
        assert.ok(['high', 'medium', 'low'].includes(pattern.baseConfidence), 'Invalid confidence');
        assert.ok(typeof pattern.minLength === 'number', 'minLength should be a number');
      }
    });
  });

  describe('real-world PR examples', () => {
    it('should extract from a typical PR description', () => {
      const prBody = `
## Summary

Added caching layer for API responses to reduce database load.

## Why

Because we were seeing high latency on repeated queries, and this optimization
reduces response time by 80% for cached data.

## Trade-offs

We chose Redis instead of Memcached because we need persistence.

## Notes

Careful: cache invalidation must be handled correctly when data changes.
      `;

      const matches = extractPatternMatches(prBody);

      // Should find multiple patterns
      assert.ok(matches.length >= 2, `Expected at least 2 matches, got ${matches.length}`);

      // Should find the trade-off decision
      const tradeoffMatch = matches.find(m => m.patternName === 'instead-of');
      assert.ok(tradeoffMatch, 'Should find trade-off');

      // Should find the careful warning
      const carefulMatch = matches.find(m => m.patternName === 'careful');
      assert.ok(carefulMatch, 'Should find careful warning');
    });

    it('should extract from a code review comment', () => {
      const comment = `
        Note: This implementation assumes the input is always valid.
        In production, make sure to validate before processing.

        Also, prefer using const over let when the value doesn't change.
      `;

      const matches = extractPatternMatches(comment);

      // Should find note and prefer patterns
      const noteMatch = matches.find(m => m.patternName === 'note');
      const preferMatch = matches.find(m => m.patternName === 'prefer');

      assert.ok(noteMatch || preferMatch, 'Should find at least one pattern');
    });
  });
});
