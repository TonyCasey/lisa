/**
 * Tests for Complexity Rater
 *
 * Tests the work complexity rating system that determines
 * whether to store in Graphiti (3+) or local logs (1-2).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module (CommonJS style)
const { rateComplexity, getRatingLabel, THRESHOLDS } = require('../complexity-rater');

interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

function createEmptyWork(): IWorkSummary {
  return {
    filesModified: new Set(),
    filesCreated: new Set(),
    commandsRun: [],
    toolsUsed: new Map(),
    assistantSummary: '',
    timestamp: new Date().toISOString(),
    durationMs: 0,
    totalCostUSD: 0,
  };
}

describe('rateComplexity', () => {
  describe('rating thresholds', () => {
    it('should return rating 1 for empty work', () => {
      const work = createEmptyWork();
      const result = rateComplexity(work);
      assert.strictEqual(result.rating, 1);
      assert.ok(result.rawScore < THRESHOLDS.RATING_2);
    });

    it('should return rating 2 for single file edit', () => {
      const work = createEmptyWork();
      work.filesModified.add('src/index.ts');
      const result = rateComplexity(work);
      assert.strictEqual(result.rating, 2);
    });

    it('should return rating 3 for multiple files with commands', () => {
      const work = createEmptyWork();
      work.filesCreated.add('src/new-feature.ts');
      work.filesModified.add('src/index.ts');
      work.commandsRun.push('npm install something');
      const result = rateComplexity(work);
      assert.ok(result.rating >= 3, `Expected rating >= 3, got ${result.rating}`);
    });

    it('should return rating 4+ for multi-directory work with tests', () => {
      const work = createEmptyWork();
      work.filesCreated.add('src/feature/component.ts');
      work.filesCreated.add('tests/feature/component.test.ts');
      work.filesCreated.add('docs/feature.md');
      work.filesModified.add('package.json');
      work.commandsRun.push('npm run build');
      work.commandsRun.push('npm test');
      const result = rateComplexity(work);
      assert.ok(result.rating >= 4, `Expected rating >= 4, got ${result.rating}`);
    });
  });

  describe('signal detection', () => {
    it('should detect version bump in package.json', () => {
      const work = createEmptyWork();
      work.filesModified.add('package.json');
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('Version bump')),
        'Should detect version bump signal'
      );
    });

    it('should detect test files', () => {
      const work = createEmptyWork();
      work.filesModified.add('src/utils.test.ts');
      work.filesCreated.add('tests/integration.spec.js');
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('test file')),
        'Should detect test file signal'
      );
    });

    it('should detect documentation files', () => {
      const work = createEmptyWork();
      work.filesCreated.add('README.md');
      work.filesCreated.add('docs/guide.md');
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('documentation')),
        'Should detect documentation signal'
      );
    });

    it('should detect CI/CD setup', () => {
      const work = createEmptyWork();
      work.filesCreated.add('.github/workflows/ci.yml');
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('CI/CD')),
        'Should detect CI/CD signal'
      );
    });

    it('should detect multi-directory changes', () => {
      const work = createEmptyWork();
      work.filesModified.add('src/index.ts');
      work.filesModified.add('lib/utils.ts');
      work.filesModified.add('tests/unit.test.ts');
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('Multi-directory')),
        'Should detect multi-directory signal'
      );
    });

    it('should detect tool diversity', () => {
      const work = createEmptyWork();
      work.toolsUsed.set('Read', 5);
      work.toolsUsed.set('Write', 3);
      work.toolsUsed.set('Edit', 4);
      work.toolsUsed.set('Bash', 2);
      work.toolsUsed.set('Glob', 1);
      const result = rateComplexity(work);
      assert.ok(
        result.signals.some((s: string) => s.includes('different tools')),
        'Should detect tool diversity signal'
      );
    });
  });

  describe('summary generation', () => {
    it('should generate summary for trivial work', () => {
      const work = createEmptyWork();
      const result = rateComplexity(work);
      assert.ok(result.summary.includes('Trivial'), `Expected Trivial in summary: ${result.summary}`);
    });

    it('should generate summary for complex work', () => {
      const work = createEmptyWork();
      // Add enough work to hit rating 4+
      for (let i = 0; i < 5; i++) {
        work.filesCreated.add(`src/module${i}/index.ts`);
        work.filesModified.add(`src/module${i}/utils.ts`);
      }
      work.commandsRun.push('npm run build', 'npm test', 'npm run lint');
      const result = rateComplexity(work);
      assert.ok(
        result.summary.includes('Complex') || result.summary.includes('Very Complex'),
        `Expected Complex/Very Complex in summary: ${result.summary}`
      );
    });
  });
});

describe('getRatingLabel', () => {
  it('should return correct labels for all ratings', () => {
    assert.strictEqual(getRatingLabel(1), 'Trivial');
    assert.strictEqual(getRatingLabel(2), 'Simple');
    assert.strictEqual(getRatingLabel(3), 'Moderate');
    assert.strictEqual(getRatingLabel(4), 'Complex');
    assert.strictEqual(getRatingLabel(5), 'Very Complex');
  });

  it('should return Unknown for invalid rating', () => {
    assert.strictEqual(getRatingLabel(0), 'Unknown');
    assert.strictEqual(getRatingLabel(6), 'Unknown');
  });
});
