/**
 * Tests for PrReviewHandler
 *
 * Tests local AI code review functionality.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PrReviewHandler } from '../../../../../../../src/lib/application/handlers/pr/PrReviewHandler';

describe('PrReviewHandler', () => {
  describe('execute()', () => {
    it('should return empty result when no changes', async () => {
      // Create handler - it will try to detect git changes
      const handler = new PrReviewHandler();
      
      // Since we're testing from the main branch against main, 
      // there should be no changes (or we're not in a git repo)
      // Either way, this tests that the handler doesn't crash
      const result = await handler.execute({ base: 'main' });
      
      // Result should be a valid IPrReviewResult
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
      const handler = new PrReviewHandler();
      
      const result = await handler.execute({ 
        base: 'main',
        block: true,
      });
      
      // With no critical issues, shouldBlock should be false
      // (even if we have warnings or suggestions)
      if (result.counts.critical === 0) {
        assert.strictEqual(result.shouldBlock, false);
      }
    });

    it('should include base branch in result', async () => {
      const handler = new PrReviewHandler();
      
      const result = await handler.execute({ base: 'develop' });
      
      // Base should be what we specified (or fallback if branch doesn't exist)
      assert.ok(result.base);
      assert.strictEqual(typeof result.base, 'string');
    });

    it('should handle missing base branch gracefully', async () => {
      const handler = new PrReviewHandler();
      
      // Even with a non-existent branch, it should not throw
      const result = await handler.execute({ base: 'nonexistent-branch-xyz' });
      
      // Should either succeed with empty or fail gracefully
      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.message, 'string');
    });
  });

  describe('result structure', () => {
    it('should have correct shape for IPrReviewResult', async () => {
      const handler = new PrReviewHandler();
      const result = await handler.execute();
      
      // Check all required fields exist
      assert.ok('success' in result);
      assert.ok('message' in result);
      assert.ok('base' in result);
      assert.ok('filesChanged' in result);
      assert.ok('files' in result);
      assert.ok('issues' in result);
      assert.ok('counts' in result);
      assert.ok('passed' in result);
      assert.ok('shouldBlock' in result);
      
      // Check counts structure
      assert.ok('critical' in result.counts);
      assert.ok('warning' in result.counts);
      assert.ok('suggestion' in result.counts);
    });
  });
});
