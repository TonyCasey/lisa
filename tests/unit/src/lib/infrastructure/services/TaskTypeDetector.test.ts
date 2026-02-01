/**
 * Tests for TaskTypeDetector (#180)
 *
 * Tests signal-based task type detection using DETECTION_SIGNALS:
 * - Planning detection (design, architecture, evaluate, etc.)
 * - Execution detection (implement, create, build, etc.)
 * - Exploration detection (explore, investigate, research, etc.)
 * - Debugging detection (bug, error, fix, debug, etc.)
 * - Default behavior (execution when no signals)
 * - Confidence scoring
 * - Edge cases
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TaskTypeDetector, createTaskTypeDetector } from '../../../../../../src/lib/infrastructure/services/TaskTypeDetector';

describe('TaskTypeDetector', () => {
  describe('planning detection', () => {
    it('should detect planning from architecture keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Let me design the architecture for this feature');

      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.confidence > 0);
      assert.ok(result.signals.length > 0);
    });

    it('should detect planning from decision keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Should we evaluate the alternatives and choose an approach?');

      assert.strictEqual(result.taskType, 'planning');
      assert.ok(result.signals.some(s => s === 'evaluate' || s === 'alternatives' || s === 'choose' || s === 'approach'));
    });

    it('should detect planning from strategy keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('We need to plan our strategy and consider the trade-offs');

      assert.strictEqual(result.taskType, 'planning');
    });
  });

  describe('execution detection', () => {
    it('should detect execution from implementation keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Implement the user authentication feature');

      assert.strictEqual(result.taskType, 'execution');
      assert.ok(result.confidence > 0);
    });

    it('should detect execution from create/build keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Create the new component and build the tests');

      assert.strictEqual(result.taskType, 'execution');
    });

    it('should detect execution from refactor keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Refactor the service to extract the validation logic');

      assert.strictEqual(result.taskType, 'execution');
    });
  });

  describe('exploration detection', () => {
    it('should detect exploration from investigate keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('I want to explore and investigate how caching works');

      assert.strictEqual(result.taskType, 'exploration');
      assert.ok(result.confidence > 0);
    });

    it('should detect exploration from research keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Let me research and experiment with different approaches');

      assert.strictEqual(result.taskType, 'exploration');
    });

    it('should detect exploration from "what if" patterns', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('What if we used a different database? Could we try that?');

      assert.strictEqual(result.taskType, 'exploration');
    });
  });

  describe('debugging detection', () => {
    it('should detect debugging from bug/error keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('There is a bug causing an error in the login flow');

      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.confidence > 0);
    });

    it('should detect debugging from fix keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Fix the failing tests and debug the issue');

      assert.strictEqual(result.taskType, 'debugging');
    });

    it('should detect debugging from crash/broken keywords', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('The app is broken and keeps crashing unexpectedly');

      assert.strictEqual(result.taskType, 'debugging');
    });
  });

  describe('default behavior', () => {
    it('should default to execution when no signals found', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Hello world');

      assert.strictEqual(result.taskType, 'execution');
      assert.strictEqual(result.confidence, 0);
      assert.deepStrictEqual(result.signals, []);
    });

    it('should default to execution for empty string', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('');

      assert.strictEqual(result.taskType, 'execution');
      assert.strictEqual(result.confidence, 0);
    });

    it('should default to execution for whitespace-only string', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('   ');

      assert.strictEqual(result.taskType, 'execution');
      assert.strictEqual(result.confidence, 0);
    });
  });

  describe('confidence scoring', () => {
    it('should have higher confidence with more signal words', () => {
      const detector = new TaskTypeDetector();

      const lowConfidence = detector.detect('Fix this thing in the application that runs the server');
      const highConfidence = detector.detect('Fix the bug, debug the error, and check the stack trace');

      assert.ok(
        highConfidence.confidence > lowConfidence.confidence,
        `Expected ${highConfidence.confidence} > ${lowConfidence.confidence}`
      );
    });

    it('should cap confidence at 1.0', () => {
      const detector = new TaskTypeDetector();
      // Very short prompt with signal word
      const result = detector.detect('fix bug');

      assert.ok(result.confidence <= 1.0, `Confidence ${result.confidence} should be <= 1.0`);
    });

    it('should return matched signals', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('Design the architecture and evaluate alternatives');

      assert.ok(result.signals.length >= 2);
      assert.ok(result.signals.includes('design'));
      assert.ok(result.signals.includes('architecture'));
    });
  });

  describe('mixed signals', () => {
    it('should pick dominant type when mixed signals present', () => {
      const detector = new TaskTypeDetector();
      // 3 execution signals (implement, create, build) vs 1 planning signal (design)
      const result = detector.detect('Implement the design: create and build the feature');

      assert.strictEqual(result.taskType, 'execution');
    });

    it('should handle case-insensitive matching', () => {
      const detector = new TaskTypeDetector();
      const result = detector.detect('DESIGN the ARCHITECTURE for our new STRATEGY');

      assert.strictEqual(result.taskType, 'planning');
    });
  });

  describe('factory function', () => {
    it('should create a working detector via factory', () => {
      const detector = createTaskTypeDetector();
      const result = detector.detect('Debug the failing test');

      assert.strictEqual(result.taskType, 'debugging');
      assert.ok(result.confidence > 0);
    });
  });
});
