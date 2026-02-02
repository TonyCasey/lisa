/**
 * Tests for ProactiveDetector (#182).
 *
 * Tests decision confirmation detection (user + assistant context),
 * milestone detection (PR, tests, completion, version), and edge cases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ProactiveDetector } from '../../../../../../src/lib/infrastructure/services/ProactiveDetector';

describe('ProactiveDetector', () => {
  describe('decision detection', () => {
    it('should detect decision when user confirms after options', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Yes, go ahead',
        'We could use option A or option B. I recommend option A.'
      );

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'decision');
      assert.strictEqual(result.confidence, 'high');
      assert.ok(result.suggestedFact?.startsWith('DECISION:'));
    });

    it('should detect "sounds good" as confirmation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Sounds good',
        'Should we use Redis or Memcached for caching?'
      );

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'decision');
    });

    it('should detect "approved" as confirmation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Approved',
        'I suggest we go with approach B for the refactor.'
      );

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'decision');
    });

    it('should detect "lets go with" as confirmation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        "Let's go with that",
        'We could either use JWT tokens or session cookies.'
      );

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'decision');
    });

    it('should detect "do that" as confirmation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Do that',
        'I recommend using TypeScript strict mode.'
      );

      assert.strictEqual(result.shouldSuggest, true);
    });

    it('should detect options when assistant uses standalone "or"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Ok',
        'Use Redis or Memcached for caching.'
      );

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'decision');
    });

    it('should detect "agreed" as confirmation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Agreed',
        'The alternative approach would be better.'
      );

      assert.strictEqual(result.shouldSuggest, true);
    });

    it('should NOT detect decision without assistant message', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Yes, go ahead');

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should NOT detect decision when assistant did not present options', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Yes',
        'I have updated the file as requested.'
      );

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should NOT detect decision for non-confirmation prompts', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Implement the caching layer',
        'We could use Redis or Memcached.'
      );

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should extract topic from assistant message', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Go ahead',
        'Should we use PostgreSQL or MongoDB for the database?'
      );

      assert.ok(result.suggestedFact?.includes('DECISION:'));
      assert.ok(result.suggestedFact?.includes('PostgreSQL'));
    });

    it('should truncate long assistant message topics to 80 chars', () => {
      const detector = new ProactiveDetector();
      const longMessage = 'We could use ' + 'x'.repeat(100) + ' or something else as an alternative approach';
      const result = detector.detect('Ok', longMessage);

      assert.ok(result.shouldSuggest);
      // DECISION: prefix + topic should have truncated topic
      const topic = result.suggestedFact?.replace('DECISION: ', '') ?? '';
      assert.ok(topic.length <= 80, `Topic length ${topic.length} should be <= 80`);
      assert.ok(topic.endsWith('...'));
    });

    it('should avoid empty decision topics when assistant starts with punctuation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect(
        'Ok',
        '... Use Redis or Memcached.'
      );

      const topic = result.suggestedFact?.replace('DECISION: ', '') ?? '';
      assert.ok(topic.length > 0, 'Decision topic should not be empty');
    });
  });

  describe('milestone detection', () => {
    it('should detect PR creation', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Created PR #42 for the feature');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
      assert.strictEqual(result.confidence, 'medium');
      assert.ok(result.suggestedFact?.startsWith('MILESTONE:'));
    });

    it('should detect "opened PR"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Opened PR for the bug fix');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should detect standalone "pull request #" phrasing', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Pull request #123 is ready');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should detect "all tests pass"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('All tests pass now');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should detect "tests passing"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('The tests passing in CI');

      assert.strictEqual(result.shouldSuggest, true);
    });

    it('should detect "0 fail"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('1456 tests, 0 fail');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should detect completion keywords', () => {
      const completionWords = ['Done with the feature', 'Finished implementing', 'Completed the refactor', 'Shipped the update', 'Merged the PR'];

      const detector = new ProactiveDetector();
      for (const word of completionWords) {
        const result = detector.detect(word);
        assert.strictEqual(
          result.shouldSuggest, true,
          `Should detect milestone for: "${word}"`
        );
      }
    });

    it('should detect "bumped version"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Bumped version to 2.13.0');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should detect version pattern "v2.13"', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Released v2.13.0');

      assert.strictEqual(result.shouldSuggest, true);
      assert.strictEqual(result.factType, 'milestone');
    });

    it('should include user prompt in milestone summary', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Created PR #99 for auth feature');

      assert.ok(result.suggestedFact?.includes('Created PR #99'));
    });
  });

  describe('priority', () => {
    it('should prioritize decision over milestone', () => {
      const detector = new ProactiveDetector();
      // User says "ok" (confirmation) AND text contains "done" (milestone)
      // But since we need assistant context for decision, "done" alone triggers milestone
      const result = detector.detect(
        'Ok',
        'We could use approach A or approach B.'
      );

      // Decision should win since it's checked first
      assert.strictEqual(result.factType, 'decision');
    });
  });

  describe('edge cases', () => {
    it('should return shouldSuggest false for empty prompt', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('');

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should return shouldSuggest false for whitespace-only prompt', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('   ');

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should return shouldSuggest false for regular prompts', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Please add error handling to the API endpoint');

      assert.strictEqual(result.shouldSuggest, false);
    });

    it('should handle undefined previousAssistantMessage', () => {
      const detector = new ProactiveDetector();
      const result = detector.detect('Yes', undefined);

      // No assistant context, so no decision detection
      assert.strictEqual(result.shouldSuggest, false);
    });
  });
});
