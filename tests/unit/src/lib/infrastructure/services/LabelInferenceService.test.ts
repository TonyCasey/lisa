/**
 * Tests for LabelInferenceService.
 *
 * Verifies:
 * - Conventional commit prefix detection
 * - Body content pattern matching
 * - Priority and phase label inference
 * - Confidence scoring
 * - Options handling
 *
 * @see Issue #21: Auto-label issues based on content
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  LabelInferenceService,
  createLabelInferenceService,
} from '../../../../../../src/lib/infrastructure/services/LabelInferenceService';

describe('LabelInferenceService', () => {
  describe('conventional commit prefixes', () => {
    it('inferLabels_givenFixPrefix_shouldReturnBugLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('fix: resolve null pointer exception', '');

      assert.ok(result.labels.includes('bug'));
      assert.ok(result.reasons['bug']?.includes('prefix'));
      assert.ok(result.confidence >= 0.9);
    });

    it('inferLabels_givenBugPrefix_shouldReturnBugLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('bug: crash on startup', '');

      assert.ok(result.labels.includes('bug'));
    });

    it('inferLabels_givenFeatPrefix_shouldReturnEnhancementLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('feat: add dark mode toggle', '');

      assert.ok(result.labels.includes('enhancement'));
      assert.ok(result.confidence >= 0.9);
    });

    it('inferLabels_givenFeaturePrefix_shouldReturnEnhancementLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('feature: implement user dashboard', '');

      assert.ok(result.labels.includes('enhancement'));
    });

    it('inferLabels_givenDocsPrefix_shouldReturnDocumentationLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('docs: update API reference', '');

      assert.ok(result.labels.includes('documentation'));
    });

    it('inferLabels_givenRefactorPrefix_shouldReturnRefactorLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('refactor: extract validation logic', '');

      assert.ok(result.labels.includes('refactor'));
    });

    it('inferLabels_givenTestPrefix_shouldReturnTestingLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('test: add unit tests for auth module', '');

      assert.ok(result.labels.includes('testing'));
    });
  });

  describe('body content patterns', () => {
    it('inferLabels_givenBugKeywordInBody_shouldReturnBugLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Issue with login',
        'There is a bug in the authentication flow that causes errors'
      );

      assert.ok(result.labels.includes('bug'));
      assert.ok(result.reasons['bug']?.includes('body'));
    });

    it('inferLabels_givenBrokenKeywordInBody_shouldReturnBugLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Login page problem',
        'The submit button is broken and does not respond'
      );

      assert.ok(result.labels.includes('bug'));
    });

    it('inferLabels_givenImplementKeywordInBody_shouldReturnEnhancementLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'User preferences',
        'We need to implement a settings page for user preferences'
      );

      assert.ok(result.labels.includes('enhancement'));
    });

    it('inferLabels_givenAddKeywordInBody_shouldReturnEnhancementLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Export feature',
        'Please add the ability to export data as CSV'
      );

      assert.ok(result.labels.includes('enhancement'));
    });

    it('inferLabels_givenDocumentKeywordInBody_shouldReturnDocumentationLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'API documentation',
        'We need to document the new REST endpoints'
      );

      assert.ok(result.labels.includes('documentation'));
    });

    it('inferLabels_givenRefactorKeywordInBody_shouldReturnRefactorLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Code cleanup',
        'The authentication module needs to be refactored for maintainability'
      );

      assert.ok(result.labels.includes('refactor'));
    });

    it('inferLabels_givenTestKeywordInBody_shouldReturnTestingLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Coverage gaps',
        'We need more unit tests for the payment module'
      );

      assert.ok(result.labels.includes('testing'));
    });
  });

  describe('priority labels', () => {
    it('inferLabels_givenCriticalKeyword_shouldReturnHighPriorityLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Production issue',
        'This is a critical bug affecting all users'
      );

      assert.ok(result.labels.includes('priority:high'));
    });

    it('inferLabels_givenUrgentKeyword_shouldReturnHighPriorityLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Security vulnerability',
        'Urgent: SQL injection vulnerability in search'
      );

      assert.ok(result.labels.includes('priority:high'));
    });

    it('inferLabels_givenBlockingKeyword_shouldReturnHighPriorityLabel', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Deploy blocked',
        'This is blocking the release pipeline'
      );

      assert.ok(result.labels.includes('priority:high'));
    });
  });

  describe('phase labels', () => {
    it('inferLabels_givenReliabilityKeyword_shouldReturnPhase1Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Connection handling',
        'Improve reliability of database connections'
      );

      assert.ok(result.labels.includes('phase:1'));
    });

    it('inferLabels_givenTimeoutKeyword_shouldReturnPhase1Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'API timeout issue',
        'Requests are getting timeout errors under load'
      );

      assert.ok(result.labels.includes('phase:1'));
    });

    it('inferLabels_givenUnitTestKeyword_shouldReturnPhase2Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Test coverage',
        'Add unit test coverage for the new module'
      );

      assert.ok(result.labels.includes('phase:2'));
    });

    it('inferLabels_givenObservabilityKeyword_shouldReturnPhase3Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Monitoring improvements',
        'Improve observability with better metrics'
      );

      assert.ok(result.labels.includes('phase:3'));
    });

    it('inferLabels_givenLoggingKeyword_shouldReturnPhase3Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Debug information',
        'Add structured logging to the pipeline'
      );

      assert.ok(result.labels.includes('phase:3'));
    });

    it('inferLabels_givenMaintainabilityKeyword_shouldReturnPhase4Label', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Code organization',
        'Improve maintainability of the codebase'
      );

      assert.ok(result.labels.includes('phase:4'));
    });
  });

  describe('options handling', () => {
    it('inferLabels_givenIncludePhaseLabelsFalse_shouldNotIncludePhaseLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Timeout issue',
        'Fix timeout problems in the API',
        { includePhaseLabels: false }
      );

      const phaseLabels = result.labels.filter(l => l.startsWith('phase:'));
      assert.strictEqual(phaseLabels.length, 0);
    });

    it('inferLabels_givenIncludePriorityLabelsFalse_shouldNotIncludePriorityLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Critical bug',
        'This is critical and blocking',
        { includePriorityLabels: false }
      );

      const priorityLabels = result.labels.filter(l => l.startsWith('priority:'));
      assert.strictEqual(priorityLabels.length, 0);
    });

    it('inferLabels_givenMaxLabels2_shouldReturnAtMost2Labels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'fix: critical bug',
        'This is critical and blocking and needs testing',
        { maxLabels: 2 }
      );

      assert.ok(result.labels.length <= 2);
    });
  });

  describe('confidence scoring', () => {
    it('inferLabels_givenPrefixMatch_shouldHaveHighConfidence', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('fix: issue', '');

      assert.ok(result.confidence >= 0.9, `Expected >= 0.9, got ${result.confidence}`);
    });

    it('inferLabels_givenBodyOnlyMatch_shouldHaveMediumConfidence', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'Issue with something',
        'There is a bug here'
      );

      assert.ok(result.confidence >= 0.5 && result.confidence < 0.9,
        `Expected 0.5-0.9, got ${result.confidence}`);
    });

    it('inferLabels_givenNoMatches_shouldHaveZeroConfidence', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('hello world', 'nothing interesting');

      assert.strictEqual(result.confidence, 0);
      assert.strictEqual(result.labels.length, 0);
    });
  });

  describe('multiple label inference', () => {
    it('inferLabels_givenBugWithHighPriority_shouldReturnBothLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'fix: critical issue',
        'This is a critical bug blocking production'
      );

      assert.ok(result.labels.includes('bug'));
      assert.ok(result.labels.includes('priority:high'));
    });

    it('inferLabels_givenFeatureWithPhase_shouldReturnBothLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels(
        'feat: add logging',
        'Implement structured logging for observability'
      );

      assert.ok(result.labels.includes('enhancement'));
      assert.ok(result.labels.includes('phase:3'));
    });
  });

  describe('createLabelInferenceService factory', () => {
    it('shouldCreateServiceWithDefaultRules', () => {
      const service = createLabelInferenceService();
      const result = service.inferLabels('fix: test', '');

      assert.ok(result.labels.includes('bug'));
    });

    it('shouldCreateServiceWithCustomRules', () => {
      const customRules = [
        {
          label: 'custom-label',
          prefixPatterns: [/^custom:/i],
          reason: 'Custom prefix match',
        },
      ];
      const service = createLabelInferenceService(customRules);
      const result = service.inferLabels('custom: test issue', '');

      assert.ok(result.labels.includes('custom-label'));
      // Should not have default rules
      assert.ok(!result.labels.includes('bug'));
    });
  });

  describe('edge cases', () => {
    it('inferLabels_givenEmptyTitleAndBody_shouldReturnNoLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('', '');

      assert.strictEqual(result.labels.length, 0);
      assert.strictEqual(result.confidence, 0);
    });

    it('inferLabels_givenWhitespaceOnly_shouldReturnNoLabels', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('   ', '   \n   ');

      assert.strictEqual(result.labels.length, 0);
    });

    it('inferLabels_givenCaseMismatch_shouldStillMatch', () => {
      const service = new LabelInferenceService();
      const result = service.inferLabels('FIX: uppercase prefix', '');

      assert.ok(result.labels.includes('bug'));
    });

    it('inferLabels_shouldDeduplicateLabels', () => {
      const service = new LabelInferenceService();
      // Both prefix and body match for bug
      const result = service.inferLabels('fix: issue', 'This is a bug');

      const bugCount = result.labels.filter(l => l === 'bug').length;
      assert.strictEqual(bugCount, 1);
    });
  });
});
