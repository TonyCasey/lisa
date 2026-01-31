/**
 * Tests for ITaskType
 *
 * Tests task type values, context strategies, detection signals,
 * and helper functions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TASK_TYPE_VALUES,
  DEFAULT_CONTEXT_STRATEGIES,
  DETECTION_SIGNALS,
  isValidTaskType,
  getDefaultStrategy,
} from '../../../../../../../src/lib/domain/interfaces/types/ITaskType';

describe('ITaskType', () => {
  describe('TASK_TYPE_VALUES', () => {
    it('should contain all four task types', () => {
      assert.deepStrictEqual([...TASK_TYPE_VALUES], [
        'planning',
        'execution',
        'exploration',
        'debugging',
      ]);
    });
  });

  describe('DEFAULT_CONTEXT_STRATEGIES', () => {
    it('should have a strategy for each task type', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        assert.ok(DEFAULT_CONTEXT_STRATEGIES[taskType], `Missing strategy for ${taskType}`);
      }
    });

    it('planning strategy should prioritize breadth', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.planning;
      assert.ok(strategy.searchTypes.includes('decision'));
      assert.ok(strategy.searchTypes.includes('retrospective'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.timeout, 4000);
      assert.strictEqual(strategy.factLimit, 150);
      assert.strictEqual(strategy.searchBreadth, 5);
    });

    it('execution strategy should prioritize precision', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.execution;
      assert.ok(strategy.searchTypes.includes('pattern'));
      assert.ok(strategy.searchTypes.includes('task'));
      assert.strictEqual(strategy.maxResults, 3);
      assert.strictEqual(strategy.timeout, 3000);
      assert.strictEqual(strategy.factLimit, 75);
      assert.strictEqual(strategy.searchBreadth, 3);
    });

    it('exploration strategy should surface related concepts', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.exploration;
      assert.ok(strategy.searchTypes.includes('decision'));
      assert.ok(strategy.searchTypes.includes('pattern'));
      assert.ok(strategy.searchTypes.includes('retrospective'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.factLimit, 100);
    });

    it('debugging strategy should target bugs and errors', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.debugging;
      assert.ok(strategy.searchTypes.includes('bug'));
      assert.ok(strategy.searchTypes.includes('error'));
      assert.ok(strategy.searchTypes.includes('gotcha'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.timeout, 4000);
      assert.strictEqual(strategy.factLimit, 100);
    });

    it('all strategies should have positive numeric values', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        const strategy = DEFAULT_CONTEXT_STRATEGIES[taskType];
        assert.ok(strategy.maxResults > 0, `${taskType} maxResults should be positive`);
        assert.ok(strategy.timeout > 0, `${taskType} timeout should be positive`);
        assert.ok(strategy.factLimit > 0, `${taskType} factLimit should be positive`);
        assert.ok(strategy.searchBreadth > 0, `${taskType} searchBreadth should be positive`);
        assert.ok(strategy.searchTypes.length > 0, `${taskType} should have search types`);
      }
    });
  });

  describe('DETECTION_SIGNALS', () => {
    it('should have signals for each task type', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        assert.ok(DETECTION_SIGNALS[taskType], `Missing signals for ${taskType}`);
        assert.ok(DETECTION_SIGNALS[taskType].length > 0, `${taskType} should have signals`);
      }
    });

    it('planning signals should include design-related keywords', () => {
      const signals = DETECTION_SIGNALS.planning;
      assert.ok(signals.includes('design'));
      assert.ok(signals.includes('plan'));
      assert.ok(signals.includes('architecture'));
      assert.ok(signals.includes('should we'));
    });

    it('execution signals should include implementation keywords', () => {
      const signals = DETECTION_SIGNALS.execution;
      assert.ok(signals.includes('implement'));
      assert.ok(signals.includes('add'));
      assert.ok(signals.includes('create'));
      assert.ok(signals.includes('build'));
    });

    it('exploration signals should include investigative keywords', () => {
      const signals = DETECTION_SIGNALS.exploration;
      assert.ok(signals.includes('what if'));
      assert.ok(signals.includes('could we'));
      assert.ok(signals.includes('brainstorm'));
      assert.ok(signals.includes('explore'));
    });

    it('debugging signals should include error-related keywords', () => {
      const signals = DETECTION_SIGNALS.debugging;
      assert.ok(signals.includes('bug'));
      assert.ok(signals.includes('error'));
      assert.ok(signals.includes('failing'));
      assert.ok(signals.includes('broken'));
      assert.ok(signals.includes('fix'));
    });
  });

  describe('isValidTaskType()', () => {
    it('should return true for planning', () => {
      assert.strictEqual(isValidTaskType('planning'), true);
    });

    it('should return true for execution', () => {
      assert.strictEqual(isValidTaskType('execution'), true);
    });

    it('should return true for exploration', () => {
      assert.strictEqual(isValidTaskType('exploration'), true);
    });

    it('should return true for debugging', () => {
      assert.strictEqual(isValidTaskType('debugging'), true);
    });

    it('should return false for invalid values', () => {
      assert.strictEqual(isValidTaskType('coding'), false);
      assert.strictEqual(isValidTaskType(''), false);
      assert.strictEqual(isValidTaskType('PLANNING'), false);
      assert.strictEqual(isValidTaskType('plan'), false);
    });
  });

  describe('getDefaultStrategy()', () => {
    it('should return planning strategy for planning', () => {
      const strategy = getDefaultStrategy('planning');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.planning);
    });

    it('should return execution strategy for execution', () => {
      const strategy = getDefaultStrategy('execution');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.execution);
    });

    it('should return exploration strategy for exploration', () => {
      const strategy = getDefaultStrategy('exploration');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.exploration);
    });

    it('should return debugging strategy for debugging', () => {
      const strategy = getDefaultStrategy('debugging');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.debugging);
    });

    it('should return a frozen object (same reference as constant)', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        const strategy = getDefaultStrategy(taskType);
        assert.strictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES[taskType]);
      }
    });
  });
});
