/**
 * Tests for Rules Loader
 *
 * Tests the functions for loading and summarizing project rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module (CommonJS style for tsx compatibility)
const {
  extractTitle,
  extractH2Headings,
  formatRuleSummary,
  RULE_CATEGORIES,
  DEFAULT_RULES_DIR,
} = require('../../../../../../../src/project/.claude/hooks/utils/core/rules-loader');

// Type definitions for test clarity
interface IRuleSummary {
  category: string;
  file: string;
  title: string;
  topics: string[];
}

describe('rules-loader', () => {
  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('RULE_CATEGORIES', () => {
    it('should include standard categories', () => {
      assert.ok(RULE_CATEGORIES.includes('shared'));
      assert.ok(RULE_CATEGORIES.includes('typescript'));
      assert.ok(RULE_CATEGORIES.includes('python'));
    });
  });

  describe('DEFAULT_RULES_DIR', () => {
    it('should be .lisa/rules', () => {
      assert.strictEqual(DEFAULT_RULES_DIR, '.lisa/rules');
    });
  });

  // ===========================================================================
  // Markdown Parsing
  // ===========================================================================

  describe('extractTitle', () => {
    it('should extract H1 title from markdown', () => {
      const content = '# My Title\n\nSome content here.';
      const result = extractTitle(content, 'fallback');
      assert.strictEqual(result, 'My Title');
    });

    it('should return fallback if no H1 found', () => {
      const content = 'No heading here\n\n## H2 heading';
      const result = extractTitle(content, 'fallback');
      assert.strictEqual(result, 'fallback');
    });

    it('should handle multiple H1s (take first)', () => {
      const content = '# First Title\n\n# Second Title';
      const result = extractTitle(content, 'fallback');
      assert.strictEqual(result, 'First Title');
    });

    it('should handle H1 not at start of file', () => {
      const content = 'Some preamble\n\n# The Title\n\nContent';
      const result = extractTitle(content, 'fallback');
      assert.strictEqual(result, 'The Title');
    });
  });

  describe('extractH2Headings', () => {
    it('should extract all H2 headings', () => {
      const content = '# Title\n\n## First\n\nContent\n\n## Second\n\n## Third';
      const result = extractH2Headings(content);
      assert.deepStrictEqual(result, ['First', 'Second', 'Third']);
    });

    it('should return empty array if no H2s', () => {
      const content = '# Title\n\nJust content, no H2s';
      const result = extractH2Headings(content);
      assert.deepStrictEqual(result, []);
    });

    it('should not include H1 or H3', () => {
      const content = '# H1\n\n## H2\n\n### H3\n\n## Another H2';
      const result = extractH2Headings(content);
      assert.deepStrictEqual(result, ['H2', 'Another H2']);
    });

    it('should handle H2 with special characters', () => {
      const content = '## Error Handling & Logging\n\n## Code-Quality Rules';
      const result = extractH2Headings(content);
      assert.deepStrictEqual(result, ['Error Handling & Logging', 'Code-Quality Rules']);
    });
  });

  // ===========================================================================
  // Formatting
  // ===========================================================================

  describe('formatRuleSummary', () => {
    it('should format rule with topics', () => {
      const rule: IRuleSummary = {
        category: 'typescript',
        file: 'coding-standards.md',
        title: 'TypeScript Coding Standards',
        topics: ['Naming', 'Types', 'Error Handling'],
      };

      const result = formatRuleSummary(rule);

      assert.strictEqual(
        result,
        '- typescript/coding-standards.md: TypeScript Coding Standards (Naming, Types, Error Handling)'
      );
    });

    it('should format rule without topics', () => {
      const rule: IRuleSummary = {
        category: 'shared',
        file: 'simple.md',
        title: 'Simple Rules',
        topics: [],
      };

      const result = formatRuleSummary(rule);

      assert.strictEqual(result, '- shared/simple.md: Simple Rules');
    });

    it('should format rule with single topic', () => {
      const rule: IRuleSummary = {
        category: 'python',
        file: 'style.md',
        title: 'Python Style Guide',
        topics: ['PEP8'],
      };

      const result = formatRuleSummary(rule);

      assert.strictEqual(result, '- python/style.md: Python Style Guide (PEP8)');
    });
  });
});
