/**
 * Tests for group-id utility functions.
 *
 * Covers:
 * - normalizeGroupId() with Windows and Unix paths
 * - getCurrentGroupId() with .lisa directory traversal
 * - getGroupIdsWithLegacy() backward compatibility
 * - getHierarchicalGroupIds() parent path generation
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  normalizeGroupId,
  getCurrentGroupId,
  getGroupIds,
  getGroupIdsWithLegacy,
  getHierarchicalGroupIds,
  createZepUserId,
  createZepThreadId,
} from '../../../../../../../src/lib/skills/shared/utils/group-id';

describe('group-id', () => {
  describe('normalizeGroupId()', () => {
    it('should normalize a Windows path', () => {
      const result = normalizeGroupId('C:\\dev\\lisa');
      assert.strictEqual(result, 'c-dev-lisa');
    });

    it('should normalize a Unix path', () => {
      const result = normalizeGroupId('/home/user/lisa');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('should handle Windows path with deep nesting', () => {
      const result = normalizeGroupId('C:\\Users\\tony\\Projects\\my-app');
      assert.strictEqual(result, 'c-users-tony-projects-my-app');
    });

    it('should handle Unix path with deep nesting', () => {
      const result = normalizeGroupId('/home/tony/projects/my-app');
      assert.strictEqual(result, 'home-tony-projects-my-app');
    });

    it('should replace dots with underscores', () => {
      const result = normalizeGroupId('/home/tony.casey/repos/api');
      assert.strictEqual(result, 'home-tony_casey-repos-api');
    });

    it('should collapse multiple consecutive separators', () => {
      const result = normalizeGroupId('/home//user///lisa');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('should handle simple basename input', () => {
      const result = normalizeGroupId('lisa');
      assert.strictEqual(result, 'lisa');
    });

    it('should lowercase everything', () => {
      const result = normalizeGroupId('MyProject');
      assert.strictEqual(result, 'myproject');
    });

    it('should handle empty string', () => {
      const result = normalizeGroupId('');
      assert.strictEqual(result, '');
    });

    it('should remove trailing separators', () => {
      const result = normalizeGroupId('/home/user/lisa/');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('should handle mixed separators', () => {
      const result = normalizeGroupId('C:\\Users/tony\\projects/app');
      assert.strictEqual(result, 'c-users-tony-projects-app');
    });
  });

  describe('getCurrentGroupId()', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-group-id-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should find .lisa in current directory', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const result = getCurrentGroupId(tempDir);
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('should find .lisa in parent directory', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const subDir = path.join(tempDir, 'src', 'lib');
      fs.mkdirSync(subDir, { recursive: true });
      const result = getCurrentGroupId(subDir);
      // Should resolve to tempDir (where .lisa is), not subDir
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('should find .lisa several levels up', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const deepDir = path.join(tempDir, 'src', 'lib', 'skills', 'shared');
      fs.mkdirSync(deepDir, { recursive: true });
      const result = getCurrentGroupId(deepDir);
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('should return a valid normalized group ID even without local .lisa', () => {
      // No .lisa directory in tempDir - may find one in an ancestor directory.
      // Either way, the result should be a valid normalized group ID.
      const result = getCurrentGroupId(tempDir);
      assert.ok(result.length > 0, 'Should return a non-empty group ID');
      assert.ok(!/[:\\\/]/.test(result), 'Should not contain path separators or colons');
    });

    it('should produce consistent IDs from different subdirectories', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const dir1 = path.join(tempDir, 'src');
      const dir2 = path.join(tempDir, 'tests', 'unit');
      fs.mkdirSync(dir1, { recursive: true });
      fs.mkdirSync(dir2, { recursive: true });

      const id1 = getCurrentGroupId(dir1);
      const id2 = getCurrentGroupId(dir2);
      const idRoot = getCurrentGroupId(tempDir);

      assert.strictEqual(id1, id2, 'IDs from different subdirectories should match');
      assert.strictEqual(id1, idRoot, 'Subdirectory ID should match root ID');
    });
  });

  describe('getGroupIdsWithLegacy()', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-group-id-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should include both canonical and legacy IDs', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const result = getGroupIdsWithLegacy(tempDir);

      const canonicalId = normalizeGroupId(tempDir);
      const legacyId = normalizeGroupId(path.basename(tempDir));

      assert.ok(result.includes(canonicalId), 'Should include canonical full-path ID');
      if (legacyId !== canonicalId) {
        assert.ok(result.includes(legacyId), 'Should include legacy basename ID');
      }
    });

    it('should not duplicate when canonical equals legacy', () => {
      // If the folder name equals the full path normalization (unlikely but test the logic)
      const result = getGroupIdsWithLegacy(tempDir);
      const uniqueIds = new Set(result);
      assert.strictEqual(result.length, uniqueIds.size, 'Should not contain duplicates');
    });

    it('should match getGroupIds output', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const legacy = getGroupIdsWithLegacy(tempDir);
      const regular = getGroupIds(tempDir);
      assert.deepStrictEqual(regular, legacy, 'getGroupIds should delegate to getGroupIdsWithLegacy');
    });
  });

  describe('getHierarchicalGroupIds()', () => {
    it('should return group IDs for path and parents', () => {
      const result = getHierarchicalGroupIds('/home/user/projects/lisa', 3);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0], 'home-user-projects-lisa');
      assert.strictEqual(result[1], 'home-user-projects');
      assert.strictEqual(result[2], 'home-user');
    });

    it('should respect maxDepth', () => {
      const result = getHierarchicalGroupIds('/home/user/projects/lisa', 1);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0], 'home-user-projects-lisa');
    });

    it('should not include duplicates', () => {
      const result = getHierarchicalGroupIds('/home/user', 5);
      const unique = new Set(result);
      assert.strictEqual(result.length, unique.size);
    });
  });

  describe('createZepUserId()', () => {
    it('should prefix with lisa-', () => {
      assert.strictEqual(createZepUserId('my-project'), 'lisa-my-project');
    });
  });

  describe('createZepThreadId()', () => {
    it('should create thread ID with purpose', () => {
      assert.strictEqual(createZepThreadId('my-project', 'memory'), 'lisa-memory-my-project');
    });
  });
});
