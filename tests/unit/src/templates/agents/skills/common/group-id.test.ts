import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePathToGroupId,
  getCurrentGroupId,
  getHierarchicalGroupIds,
  getRootBoundary,
  MAX_GROUP_ID_LENGTH,
  TYPE_MAP,
  PREFIX_MAP,
  detectPrefixTag,
} from '../../../../../../../src/lib/skills/common/group-id';

describe('normalizePathToGroupId', () => {
  test('should convert Unix path to group ID', () => {
    const result = normalizePathToGroupId('/Users/tony/Repos/api');
    assert.equal(result, 'users-tony-repos-api');
  });

  test('should convert Windows path to group ID', () => {
    const result = normalizePathToGroupId('C:\\dev\\lisa');
    assert.equal(result, 'c-dev-lisa');
  });

  test('should handle dots in path', () => {
    const result = normalizePathToGroupId('/Users/tony.casey/Repos');
    assert.equal(result, 'users-tony_casey-repos');
  });

  test('should collapse multiple dashes', () => {
    const result = normalizePathToGroupId('/Users//tony///Repos');
    assert.equal(result, 'users-tony-repos');
  });

  test('should remove leading dashes', () => {
    const result = normalizePathToGroupId('///Users/tony');
    assert.equal(result, 'users-tony');
  });

  test('should truncate long paths from the end', () => {
    const longPath = '/Users/' + 'a'.repeat(200) + '/project';
    const result = normalizePathToGroupId(longPath);
    assert.ok(result.length <= MAX_GROUP_ID_LENGTH);
    assert.ok(result.endsWith('project'));
  });

  test('should lowercase the result', () => {
    const result = normalizePathToGroupId('/Users/TONY/MyProject');
    assert.equal(result, 'users-tony-myproject');
  });
});

describe('getCurrentGroupId', () => {
  test('should return normalized group ID for given path', () => {
    const result = getCurrentGroupId('/Users/tony/project');
    assert.equal(result, 'users-tony-project');
  });

  test('should handle Windows paths', () => {
    const result = getCurrentGroupId('C:\\dev\\my-project');
    assert.equal(result, 'c-dev-my-project');
  });
});

describe('getHierarchicalGroupIds', () => {
  test('should return array of group IDs from specific to general', () => {
    // This test depends on the platform, so we just verify structure
    const result = getHierarchicalGroupIds('/home/user/projects/myapp');
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    // Most specific should be first
    assert.ok(result[0].includes('myapp'));
  });

  test('should limit depth to prevent infinite loops', () => {
    const result = getHierarchicalGroupIds('/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o');
    assert.ok(result.length <= 11); // maxDepth + 1
  });

  test('should handle single directory', () => {
    const result = getHierarchicalGroupIds('/home');
    assert.ok(result.length >= 1);
  });
});

describe('TYPE_MAP', () => {
  test('should have code category types', () => {
    assert.equal(TYPE_MAP['decision'], 'code:decision');
    assert.equal(TYPE_MAP['pattern'], 'code:pattern');
    assert.equal(TYPE_MAP['dependency'], 'code:dependency');
    assert.equal(TYPE_MAP['tech-debt'], 'code:tech-debt');
  });

  test('should have context category types', () => {
    assert.equal(TYPE_MAP['bug'], 'context:bug');
    assert.equal(TYPE_MAP['rationale'], 'context:rationale');
    assert.equal(TYPE_MAP['failed'], 'context:failed');
  });

  test('should have project category types', () => {
    assert.equal(TYPE_MAP['milestone'], 'project:milestone');
    assert.equal(TYPE_MAP['scope-in'], 'project:scope-in');
    assert.equal(TYPE_MAP['scope-out'], 'project:scope-out');
  });
});

describe('detectPrefixTag', () => {
  test('should detect DECISION prefix', () => {
    const result = detectPrefixTag('DECISION: Use TypeScript');
    assert.equal(result, 'code:decision');
  });

  test('should detect lowercase prefix', () => {
    const result = detectPrefixTag('decision: Use TypeScript');
    assert.equal(result, 'code:decision');
  });

  test('should detect BUG prefix', () => {
    const result = detectPrefixTag('BUG: Memory leak in parser');
    assert.equal(result, 'context:bug');
  });

  test('should return null for MILESTONE prefix (not in PREFIX_MAP)', () => {
    // MILESTONE is in TYPE_MAP but not PREFIX_MAP, so detectPrefixTag returns null
    const result = detectPrefixTag('MILESTONE: Release v1.0');
    assert.equal(result, null);
  });

  test('should return null for no matching prefix', () => {
    const result = detectPrefixTag('Just some regular text');
    assert.equal(result, null);
  });

  test('should return null for empty string', () => {
    const result = detectPrefixTag('');
    assert.equal(result, null);
  });

  test('should detect BLOCKER prefix', () => {
    const result = detectPrefixTag('BLOCKER: Waiting on API approval');
    assert.equal(result, 'people:blocker');
  });

  test('should detect INIT-REVIEW prefix', () => {
    const result = detectPrefixTag('INIT-REVIEW: Project analysis complete');
    assert.equal(result, 'type:init-review');
  });
});

describe('PREFIX_MAP', () => {
  test('should have expected prefixes', () => {
    assert.ok('DECISION:' in PREFIX_MAP);
    assert.ok('BUG:' in PREFIX_MAP);
    assert.ok('PATTERN:' in PREFIX_MAP);
    assert.ok('BLOCKER:' in PREFIX_MAP);
  });
});

describe('MAX_GROUP_ID_LENGTH', () => {
  test('should be 128', () => {
    assert.equal(MAX_GROUP_ID_LENGTH, 128);
  });
});
