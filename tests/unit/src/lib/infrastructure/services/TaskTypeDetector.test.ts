/**
 * Tests for TaskTypeDetector
 *
 * Tests signal-based task type detection from user prompts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TaskTypeDetector } from '../../../../../../src/lib/infrastructure/services/TaskTypeDetector';

describe('TaskTypeDetector', () => {
  const detector = new TaskTypeDetector();

  describe('planning detection', () => {
    it('should detect "plan the architecture" as planning', () => {
      const result = detector.detect('plan the architecture for the new API');
      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.confidence > 0);
      assert.ok(result.signals.includes('plan'));
      assert.ok(result.signals.includes('architecture'));
    });

    it('should detect "should we use X or Y" as planning', () => {
      const result = detector.detect('should we use Redis or Memcached for caching?');
      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.signals.includes('should we'));
    });

    it('should detect "design a strategy" as planning', () => {
      const result = detector.detect('design a strategy for migrating the database');
      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.signals.includes('design'));
      assert.ok(result.signals.includes('strategy'));
    });

    it('should detect "evaluate alternatives" as planning', () => {
      const result = detector.detect('evaluate alternatives for the authentication approach');
      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.signals.includes('evaluate'));
      assert.ok(result.signals.includes('alternatives'));
      assert.ok(result.signals.includes('approach'));
    });
  });

  describe('execution detection', () => {
    it('should detect "implement the login form" as execution', () => {
      const result = detector.detect('implement the login form with validation');
      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.signals.includes('implement'));
    });

    it('should detect "add a new endpoint" as execution', () => {
      const result = detector.detect('add a new REST endpoint for user profiles');
      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.signals.includes('add'));
    });

    it('should detect "create the database migration" as execution', () => {
      const result = detector.detect('create the database migration for the users table');
      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.signals.includes('create'));
    });

    it('should detect "refactor the service layer" as execution', () => {
      const result = detector.detect('refactor the service layer to use dependency injection');
      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.signals.includes('refactor'));
    });

    it('should detect "build the Docker image" as execution', () => {
      const result = detector.detect('build the Docker image and configure the pipeline');
      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.signals.includes('build'));
      assert.ok(result.signals.includes('configure'));
    });
  });

  describe('exploration detection', () => {
    it('should detect "what if we changed the schema" as exploration', () => {
      const result = detector.detect('what if we changed the database schema to use JSON columns?');
      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.signals.includes('what if'));
    });

    it('should detect "could we use a different approach" as exploration', () => {
      const result = detector.detect('could we use a different approach for state management?');
      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.signals.includes('could we'));
    });

    it('should detect "brainstorm ideas" as exploration', () => {
      const result = detector.detect('brainstorm ideas for improving the onboarding flow');
      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.signals.includes('brainstorm'));
    });

    it('should detect "explore the codebase" as exploration', () => {
      const result = detector.detect('explore how the authentication module works');
      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.signals.includes('explore'));
    });

    it('should detect "how does this work" as exploration', () => {
      const result = detector.detect('how does the event system handle retries?');
      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.signals.includes('how does'));
    });
  });

  describe('debugging detection', () => {
    it('should detect "fix the bug in login" as debugging', () => {
      const result = detector.detect('fix the bug in the login flow');
      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.signals.includes('fix'));
      assert.ok(result.signals.includes('bug'));
    });

    it('should detect "error when submitting form" as debugging', () => {
      const result = detector.detect('there is an error when submitting the registration form');
      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.signals.includes('error'));
    });

    it('should detect "tests are failing with errors" as debugging', () => {
      const result = detector.detect('the unit tests are failing with an unexpected error');
      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.signals.includes('failing'));
      assert.ok(result.signals.includes('error'));
      assert.ok(result.signals.includes('unexpected'));
    });

    it('should detect "app is crashing" as debugging', () => {
      const result = detector.detect('the app is crashing on startup with a stack trace');
      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.signals.includes('crash'));
      assert.ok(result.signals.includes('stack trace'));
    });

    it('should detect "not working as expected" as debugging', () => {
      const result = detector.detect('the API endpoint is not working and returns unexpected results');
      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.signals.includes('not working'));
      assert.ok(result.signals.includes('unexpected'));
    });
  });

  describe('edge cases', () => {
    it('should default to execution for empty string', () => {
      const result = detector.detect('');
      assert.strictEqual(result.taskType, 'execution');
      assert.strictEqual(result.confidence, 0);
      assert.deepStrictEqual(result.signals, []);
    });

    it('should default to execution for whitespace-only input', () => {
      const result = detector.detect('   ');
      assert.strictEqual(result.taskType, 'execution');
      assert.strictEqual(result.confidence, 0);
    });

    it('should default to execution for ambiguous prompt', () => {
      const result = detector.detect('hello there');
      assert.strictEqual(result.taskType, 'execution');
    });

    it('should be case-insensitive', () => {
      const result = detector.detect('PLAN THE ARCHITECTURE');
      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.signals.includes('plan'));
      assert.ok(result.signals.includes('architecture'));
    });

    it('should handle mixed signals with dominant type winning', () => {
      // "fix" is debugging, "implement" is execution, but "bug", "error", "broken" are all debugging
      const result = detector.detect('fix the bug causing an error because something is broken');
      assert.strictEqual(result.taskType, 'debugging');
    });

    it('should return confidence between 0 and 1', () => {
      const prompts = [
        'plan the architecture',
        'implement the feature',
        'what if we try something',
        'fix the bug',
        'hello world',
      ];
      for (const prompt of prompts) {
        const result = detector.detect(prompt);
        assert.ok(result.confidence >= 0, `confidence should be >= 0 for "${prompt}"`);
        assert.ok(result.confidence <= 1, `confidence should be <= 1 for "${prompt}"`);
      }
    });

    it('should give higher weight to multi-word phrases', () => {
      // "what if" (phrase) should give exploration more weight than a single-keyword match
      const result = detector.detect('what if we explore this');
      assert.strictEqual(result.taskType, 'exploration');
      // Both "what if" and "explore" should be signals
      assert.ok(result.signals.includes('what if'));
      assert.ok(result.signals.includes('explore'));
    });

    it('signals should be an array of matched keywords', () => {
      const result = detector.detect('design the plan and architecture');
      assert.ok(Array.isArray(result.signals));
      assert.ok(result.signals.length > 0);
      for (const signal of result.signals) {
        assert.strictEqual(typeof signal, 'string');
      }
    });
  });
});
