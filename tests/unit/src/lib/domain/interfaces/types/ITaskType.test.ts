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
    it('TASK_TYPE_VALUES_givenModule_shouldContainAllFourTaskTypes', () => {
      assert.deepStrictEqual([...TASK_TYPE_VALUES], [
        'planning',
        'execution',
        'exploration',
        'debugging',
      ]);
    });
  });

  describe('DEFAULT_CONTEXT_STRATEGIES', () => {
    it('DEFAULT_CONTEXT_STRATEGIES_givenAllTaskTypes_shouldHaveStrategyForEach', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        assert.ok(DEFAULT_CONTEXT_STRATEGIES[taskType], `Missing strategy for ${taskType}`);
      }
    });

    it('DEFAULT_CONTEXT_STRATEGIES_givenPlanning_shouldPrioritizeBreadth', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.planning;
      assert.ok(strategy.searchTypes.includes('decision'));
      assert.ok(strategy.searchTypes.includes('retrospective'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.timeout, 4000);
      assert.strictEqual(strategy.factLimit, 150);
      assert.strictEqual(strategy.searchBreadth, 5);
    });

    it('DEFAULT_CONTEXT_STRATEGIES_givenExecution_shouldPrioritizePrecision', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.execution;
      assert.ok(strategy.searchTypes.includes('pattern'));
      assert.ok(strategy.searchTypes.includes('task'));
      assert.strictEqual(strategy.maxResults, 3);
      assert.strictEqual(strategy.timeout, 3000);
      assert.strictEqual(strategy.factLimit, 75);
      assert.strictEqual(strategy.searchBreadth, 3);
    });

    it('DEFAULT_CONTEXT_STRATEGIES_givenExploration_shouldSurfaceRelatedConcepts', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.exploration;
      assert.ok(strategy.searchTypes.includes('decision'));
      assert.ok(strategy.searchTypes.includes('pattern'));
      assert.ok(strategy.searchTypes.includes('retrospective'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.factLimit, 100);
    });

    it('DEFAULT_CONTEXT_STRATEGIES_givenDebugging_shouldTargetBugsAndErrors', () => {
      const strategy = DEFAULT_CONTEXT_STRATEGIES.debugging;
      assert.ok(strategy.searchTypes.includes('bug'));
      assert.ok(strategy.searchTypes.includes('error'));
      assert.ok(strategy.searchTypes.includes('gotcha'));
      assert.strictEqual(strategy.maxResults, 5);
      assert.strictEqual(strategy.timeout, 4000);
      assert.strictEqual(strategy.factLimit, 100);
    });

    it('DEFAULT_CONTEXT_STRATEGIES_givenAnyTaskType_shouldHavePositiveNumericValues', () => {
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
    it('DETECTION_SIGNALS_givenAllTaskTypes_shouldHaveSignalsForEach', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        assert.ok(DETECTION_SIGNALS[taskType], `Missing signals for ${taskType}`);
        assert.ok(DETECTION_SIGNALS[taskType].length > 0, `${taskType} should have signals`);
      }
    });

    it('DETECTION_SIGNALS_givenPlanning_shouldIncludeDesignKeywords', () => {
      const signals = DETECTION_SIGNALS.planning;
      assert.ok(signals.includes('design'));
      assert.ok(signals.includes('plan'));
      assert.ok(signals.includes('architecture'));
      assert.ok(signals.includes('should we'));
    });

    it('DETECTION_SIGNALS_givenExecution_shouldIncludeImplementationKeywords', () => {
      const signals = DETECTION_SIGNALS.execution;
      assert.ok(signals.includes('implement'));
      assert.ok(signals.includes('add'));
      assert.ok(signals.includes('create'));
      assert.ok(signals.includes('build'));
    });

    it('DETECTION_SIGNALS_givenExploration_shouldIncludeInvestigativeKeywords', () => {
      const signals = DETECTION_SIGNALS.exploration;
      assert.ok(signals.includes('what if'));
      assert.ok(signals.includes('could we'));
      assert.ok(signals.includes('brainstorm'));
      assert.ok(signals.includes('explore'));
    });

    it('DETECTION_SIGNALS_givenDebugging_shouldIncludeErrorKeywords', () => {
      const signals = DETECTION_SIGNALS.debugging;
      assert.ok(signals.includes('bug'));
      assert.ok(signals.includes('error'));
      assert.ok(signals.includes('failing'));
      assert.ok(signals.includes('broken'));
      assert.ok(signals.includes('fix'));
    });
  });

  describe('isValidTaskType()', () => {
    it('isValidTaskType_givenPlanning_shouldReturnTrue', () => {
      assert.strictEqual(isValidTaskType('planning'), true);
    });

    it('isValidTaskType_givenExecution_shouldReturnTrue', () => {
      assert.strictEqual(isValidTaskType('execution'), true);
    });

    it('isValidTaskType_givenExploration_shouldReturnTrue', () => {
      assert.strictEqual(isValidTaskType('exploration'), true);
    });

    it('isValidTaskType_givenDebugging_shouldReturnTrue', () => {
      assert.strictEqual(isValidTaskType('debugging'), true);
    });

    it('isValidTaskType_givenInvalidValues_shouldReturnFalse', () => {
      assert.strictEqual(isValidTaskType('coding'), false);
      assert.strictEqual(isValidTaskType(''), false);
      assert.strictEqual(isValidTaskType('PLANNING'), false);
      assert.strictEqual(isValidTaskType('plan'), false);
    });
  });

  describe('getDefaultStrategy()', () => {
    it('getDefaultStrategy_givenPlanning_shouldReturnPlanningStrategy', () => {
      const strategy = getDefaultStrategy('planning');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.planning);
    });

    it('getDefaultStrategy_givenExecution_shouldReturnExecutionStrategy', () => {
      const strategy = getDefaultStrategy('execution');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.execution);
    });

    it('getDefaultStrategy_givenExploration_shouldReturnExplorationStrategy', () => {
      const strategy = getDefaultStrategy('exploration');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.exploration);
    });

    it('getDefaultStrategy_givenDebugging_shouldReturnDebuggingStrategy', () => {
      const strategy = getDefaultStrategy('debugging');
      assert.deepStrictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES.debugging);
    });

    it('getDefaultStrategy_givenAnyTaskType_shouldReturnSameReferenceAsConstant', () => {
      for (const taskType of TASK_TYPE_VALUES) {
        const strategy = getDefaultStrategy(taskType);
        assert.strictEqual(strategy, DEFAULT_CONTEXT_STRATEGIES[taskType]);
      }
    });
  });
});
