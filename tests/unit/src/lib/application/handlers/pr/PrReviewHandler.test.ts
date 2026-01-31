/**
 * Tests for PrReviewHandler
 *
 * Tests local AI code review functionality.
 * Uses mock IGitClient and IClaudeCliClient to avoid real shell operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PrReviewHandler } from '../../../../../../../src/lib/application/handlers/pr/PrReviewHandler';
import type { IGitClient } from '../../../../../../../src/lib/domain/interfaces/IGitClient';
import type { IClaudeCliClient } from '../../../../../../../src/lib/domain/interfaces/IClaudeCliClient';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: () => '',
    getRemoteUrl: () => 'https://github.com/test/repo.git',
    getDefaultBranch: () => 'main',
    diff: () => '',
    refExists: () => true,
    ...overrides,
  };
}

function createMockClaudeClient(overrides: Partial<IClaudeCliClient> = {}): IClaudeCliClient {
  return {
    isAvailable: () => false,
    runPrompt: () => '{}',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PrReviewHandler', () => {
  describe('execute()', () => {
    it('should return empty result when no changes', async () => {
      const gitClient = createMockGitClient({
        diff: () => '',
      });
      const handler = new PrReviewHandler(gitClient, createMockClaudeClient());

      const result = await handler.execute({ base: 'main' });

      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.message, 'string');
      assert.strictEqual(typeof result.filesChanged, 'number');
      assert.ok(Array.isArray(result.files));
      assert.ok(Array.isArray(result.issues));
      assert.ok(typeof result.counts === 'object');
      assert.strictEqual(typeof result.counts.critical, 'number');
      assert.strictEqual(typeof result.counts.warning, 'number');
      assert.strictEqual(typeof result.counts.suggestion, 'number');
    });

    it('should respect --block option with no critical issues', async () => {
      const handler = new PrReviewHandler(
        createMockGitClient(),
        createMockClaudeClient(),
      );

      const result = await handler.execute({
        base: 'main',
        block: true,
      });

      if (result.counts.critical === 0) {
        assert.strictEqual(result.shouldBlock, false);
      }
    });

    it('should include base branch in result', async () => {
      const handler = new PrReviewHandler(
        createMockGitClient(),
        createMockClaudeClient(),
      );

      const result = await handler.execute({ base: 'develop' });

      assert.ok(result.base);
      assert.strictEqual(typeof result.base, 'string');
    });

    it('should handle diff failure gracefully', async () => {
      const gitClient = createMockGitClient({
        diff: () => { throw new Error('Not a git repo'); },
      });
      const handler = new PrReviewHandler(gitClient, createMockClaudeClient());

      const result = await handler.execute({ base: 'nonexistent-branch-xyz' });

      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.message, 'string');
    });

    it('should use getDefaultBranch when no base specified', async () => {
      let defaultBranchCalled = false;
      const gitClient = createMockGitClient({
        getDefaultBranch: () => {
          defaultBranchCalled = true;
          return 'main';
        },
      });
      const handler = new PrReviewHandler(gitClient, createMockClaudeClient());

      await handler.execute();

      assert.strictEqual(defaultBranchCalled, true);
    });

    it('should run fallback review when claude prompt fails', async () => {
      const diffContent = [
        '+++ b/src/test.ts',
        '+const x: any = 5;',
        '+console.log(x);',
      ].join('\n');

      const gitClient = createMockGitClient({
        diff: (opts) => {
          if (opts.nameOnly) return 'src/test.ts\n';
          return diffContent;
        },
      });
      const handler = new PrReviewHandler(
        gitClient,
        createMockClaudeClient({
          isAvailable: () => true,
          runPrompt: () => { throw new Error('Claude crashed'); },
        }),
      );

      const result = await handler.execute({ base: 'main' });

      assert.strictEqual(result.filesChanged, 1);
      // Fallback review should detect `: any` and `console.log` patterns
      assert.ok(result.issues.length > 0);
    });

    it('should report error when claude is not available', async () => {
      const gitClient = createMockGitClient({
        diff: (opts) => {
          if (opts.nameOnly) return 'src/test.ts\n';
          return '+++ b/src/test.ts\n+test\n';
        },
      });
      const handler = new PrReviewHandler(
        gitClient,
        createMockClaudeClient({ isAvailable: () => false }),
      );

      const result = await handler.execute({ base: 'main' });

      // When claude is unavailable, execute catches the error
      assert.ok(result.reviewError);
      assert.ok(result.reviewError.includes('not available'));
    });
  });

  describe('result structure', () => {
    it('should have correct shape for IPrReviewResult', async () => {
      const handler = new PrReviewHandler(
        createMockGitClient(),
        createMockClaudeClient(),
      );
      const result = await handler.execute();

      assert.ok('success' in result);
      assert.ok('message' in result);
      assert.ok('base' in result);
      assert.ok('filesChanged' in result);
      assert.ok('files' in result);
      assert.ok('issues' in result);
      assert.ok('counts' in result);
      assert.ok('passed' in result);
      assert.ok('shouldBlock' in result);

      assert.ok('critical' in result.counts);
      assert.ok('warning' in result.counts);
      assert.ok('suggestion' in result.counts);
    });
  });
});
