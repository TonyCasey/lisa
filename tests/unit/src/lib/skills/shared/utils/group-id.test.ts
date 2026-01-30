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
    it('normalizeGroupId_givenWindowsPath_shouldNormalizeToLowercaseHyphenated', () => {
      const result = normalizeGroupId('C:\\dev\\lisa');
      assert.strictEqual(result, 'c-dev-lisa');
    });

    it('normalizeGroupId_givenUnixPath_shouldNormalizeToHyphenated', () => {
      const result = normalizeGroupId('/home/user/lisa');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('normalizeGroupId_givenWindowsDeepNesting_shouldPreserveSegments', () => {
      const result = normalizeGroupId('C:\\Users\\tony\\Projects\\my-app');
      assert.strictEqual(result, 'c-users-tony-projects-my-app');
    });

    it('normalizeGroupId_givenUnixDeepNesting_shouldPreserveSegments', () => {
      const result = normalizeGroupId('/home/tony/projects/my-app');
      assert.strictEqual(result, 'home-tony-projects-my-app');
    });

    it('normalizeGroupId_givenDotsInSegment_shouldReplaceDotsWithUnderscores', () => {
      const result = normalizeGroupId('/home/tony.casey/repos/api');
      assert.strictEqual(result, 'home-tony_casey-repos-api');
    });

    it('normalizeGroupId_givenMultipleConsecutiveSeparators_shouldCollapseToSingleDash', () => {
      const result = normalizeGroupId('/home//user///lisa');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('normalizeGroupId_givenBasenameOnly_shouldReturnBasename', () => {
      const result = normalizeGroupId('lisa');
      assert.strictEqual(result, 'lisa');
    });

    it('normalizeGroupId_givenMixedCase_shouldLowercaseAll', () => {
      const result = normalizeGroupId('MyProject');
      assert.strictEqual(result, 'myproject');
    });

    it('normalizeGroupId_givenEmptyString_shouldReturnEmptyString', () => {
      const result = normalizeGroupId('');
      assert.strictEqual(result, '');
    });

    it('normalizeGroupId_givenTrailingSeparators_shouldTrimTrailing', () => {
      const result = normalizeGroupId('/home/user/lisa/');
      assert.strictEqual(result, 'home-user-lisa');
    });

    it('normalizeGroupId_givenMixedSeparators_shouldNormalizeBoth', () => {
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

    it('getCurrentGroupId_givenDotLisaInCurrentDir_shouldReturnNormalizedGroupId', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const result = getCurrentGroupId(tempDir);
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('getCurrentGroupId_givenDotLisaInParentDir_shouldReturnParentNormalizedGroupId', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const subDir = path.join(tempDir, 'src', 'lib');
      fs.mkdirSync(subDir, { recursive: true });
      const result = getCurrentGroupId(subDir);
      // Should resolve to tempDir (where .lisa is), not subDir
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('getCurrentGroupId_givenDotLisaSeveralLevelsUp_shouldReturnAncestorNormalizedGroupId', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const deepDir = path.join(tempDir, 'src', 'lib', 'skills', 'shared');
      fs.mkdirSync(deepDir, { recursive: true });
      const result = getCurrentGroupId(deepDir);
      assert.strictEqual(result, normalizeGroupId(tempDir));
    });

    it('getCurrentGroupId_givenNoLocalDotLisa_shouldReturnValidNormalizedGroupId', () => {
      // No .lisa directory in tempDir - may find one in an ancestor directory.
      // Either way, the result should be a valid normalized group ID.
      const result = getCurrentGroupId(tempDir);
      assert.ok(result.length > 0, 'Should return a non-empty group ID');
      assert.ok(!/[:\\\/]/.test(result), 'Should not contain path separators or colons');
    });

    it('getCurrentGroupId_givenDifferentSubdirectories_shouldProduceConsistentIds', () => {
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

    it('getGroupIdsWithLegacy_givenRepoWithLisaFolder_shouldIncludeCanonicalAndLegacyIds', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const result = getGroupIdsWithLegacy(tempDir);

      const canonicalId = normalizeGroupId(tempDir);
      const legacyId = normalizeGroupId(path.basename(tempDir));

      assert.ok(result.includes(canonicalId), 'Should include canonical full-path ID');
      if (legacyId !== canonicalId) {
        assert.ok(result.includes(legacyId), 'Should include legacy basename ID');
      }
    });

    it('getGroupIdsWithLegacy_givenCanonicalEqualsLegacy_shouldNotContainDuplicates', () => {
      // If the folder name equals the full path normalization (unlikely but test the logic)
      const result = getGroupIdsWithLegacy(tempDir);
      const uniqueIds = new Set(result);
      assert.strictEqual(result.length, uniqueIds.size, 'Should not contain duplicates');
    });

    it('getGroupIdsWithLegacy_givenLisaFolder_shouldMatchGetGroupIdsOutput', () => {
      fs.mkdirSync(path.join(tempDir, '.lisa'), { recursive: true });
      const legacy = getGroupIdsWithLegacy(tempDir);
      const regular = getGroupIds(tempDir);
      assert.deepStrictEqual(regular, legacy, 'getGroupIds should delegate to getGroupIdsWithLegacy');
    });
  });

  describe('getHierarchicalGroupIds()', () => {
    it('getHierarchicalGroupIds_givenPathAndDepth3_shouldReturnGroupIdsForPathAndParents', () => {
      const result = getHierarchicalGroupIds('/home/user/projects/lisa', 3);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0], 'home-user-projects-lisa');
      assert.strictEqual(result[1], 'home-user-projects');
      assert.strictEqual(result[2], 'home-user');
    });

    it('getHierarchicalGroupIds_givenMaxDepth1_shouldRespectMaxDepth', () => {
      const result = getHierarchicalGroupIds('/home/user/projects/lisa', 1);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0], 'home-user-projects-lisa');
    });

    it('getHierarchicalGroupIds_givenShortPath_shouldNotIncludeDuplicates', () => {
      const result = getHierarchicalGroupIds('/home/user', 5);
      const unique = new Set(result);
      assert.strictEqual(result.length, unique.size);
    });
  });

  describe('createZepUserId()', () => {
    it('createZepUserId_givenProjectName_shouldPrefixWithLisa', () => {
      assert.strictEqual(createZepUserId('my-project'), 'lisa-my-project');
    });
  });

  describe('createZepThreadId()', () => {
    it('createZepThreadId_givenProjectAndPurpose_shouldReturnThreadId', () => {
      assert.strictEqual(createZepThreadId('my-project', 'memory'), 'lisa-memory-my-project');
    });
  });
});
