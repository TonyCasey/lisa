/**
 * Tests for issue-refs utility
 *
 * Tests extraction of issue references from text including:
 * - Simple references (#123)
 * - Cross-repo references (owner/repo#123)
 * - Prefixed references (Fixes #123, Closes owner/repo#456)
 * - Various edge cases
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractIssueRefs,
  extractIssueRefsWithContext,
  buildIssueUrl,
  formatIssueRefs,
  hasIssueRefs,
  hasClosingRefs,
} from '../../../../../../../src/lib/skills/shared/utils/issue-refs';

describe('issue-refs', () => {
  describe('extractIssueRefs()', () => {
    it('should extract simple issue reference', () => {
      const refs = extractIssueRefs('Fixed bug in #123');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].number, 123);
      assert.strictEqual(refs[0].prefix, undefined);
      assert.strictEqual(refs[0].owner, undefined);
      assert.strictEqual(refs[0].repo, undefined);
    });

    it('should extract multiple issue references', () => {
      const refs = extractIssueRefs('Related to #123 and #456');
      assert.strictEqual(refs.length, 2);
      assert.strictEqual(refs[0].number, 123);
      assert.strictEqual(refs[1].number, 456);
    });

    it('should extract cross-repo reference', () => {
      const refs = extractIssueRefs('See myorg/other-repo#789');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].number, 789);
      assert.strictEqual(refs[0].owner, 'myorg');
      assert.strictEqual(refs[0].repo, 'other-repo');
    });

    it('should extract reference with fixes prefix', () => {
      const refs = extractIssueRefs('Fixes #100');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].number, 100);
      assert.strictEqual(refs[0].prefix, 'fixes');
    });

    it('should extract reference with closes prefix', () => {
      const refs = extractIssueRefs('Closes #200');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].prefix, 'closes');
    });

    it('should extract reference with resolves prefix', () => {
      const refs = extractIssueRefs('Resolves #300');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].prefix, 'resolves');
    });

    it('should extract reference with refs prefix', () => {
      const refs = extractIssueRefs('refs #400');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].prefix, 'refs');
    });

    it('should handle case-insensitive prefixes', () => {
      const refs = extractIssueRefs('FIXES #1, Closes #2, RESOLVES #3');
      assert.strictEqual(refs.length, 3);
      assert.strictEqual(refs[0].prefix, 'fixes');
      assert.strictEqual(refs[1].prefix, 'closes');
      assert.strictEqual(refs[2].prefix, 'resolves');
    });

    it('should extract prefixed cross-repo reference', () => {
      const refs = extractIssueRefs('Closes org/project#500');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].number, 500);
      assert.strictEqual(refs[0].prefix, 'closes');
      assert.strictEqual(refs[0].owner, 'org');
      assert.strictEqual(refs[0].repo, 'project');
    });

    it('should return empty array for text with no references', () => {
      const refs = extractIssueRefs('No issues mentioned here');
      assert.strictEqual(refs.length, 0);
    });

    it('should return empty array for empty string', () => {
      const refs = extractIssueRefs('');
      assert.strictEqual(refs.length, 0);
    });

    it('should handle multi-line text', () => {
      const text = `This commit:
- Fixes #100
- Closes org/repo#200
- Also relates to #300`;
      const refs = extractIssueRefs(text);
      assert.strictEqual(refs.length, 3);
    });

    it('should include raw matched text', () => {
      const refs = extractIssueRefs('Fixes org/repo#123');
      assert.strictEqual(refs[0].raw, 'Fixes org/repo#123');
    });

    it('should handle repos with dots and dashes', () => {
      const refs = extractIssueRefs('See my-org/my.repo#999');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].owner, 'my-org');
      assert.strictEqual(refs[0].repo, 'my.repo');
      assert.strictEqual(refs[0].number, 999);
    });

    it('should not match issue numbers with letters', () => {
      const refs = extractIssueRefs('#abc is not valid');
      assert.strictEqual(refs.length, 0);
    });

    it('should handle issue at start of text', () => {
      const refs = extractIssueRefs('#123 is the main issue');
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].number, 123);
    });
  });

  describe('extractIssueRefsWithContext()', () => {
    it('should categorize closing refs', () => {
      const result = extractIssueRefsWithContext('Fixes #1, refs #2, Closes #3');
      assert.strictEqual(result.refs.length, 3);
      assert.strictEqual(result.closingRefs.length, 2);
      assert.strictEqual(result.mentionRefs.length, 1);
      assert.strictEqual(result.hasClosingRefs, true);
    });

    it('should handle text with only mention refs', () => {
      const result = extractIssueRefsWithContext('refs #100, related to #200');
      assert.strictEqual(result.closingRefs.length, 0);
      assert.strictEqual(result.mentionRefs.length, 2);
      assert.strictEqual(result.hasClosingRefs, false);
    });

    it('should handle text with only closing refs', () => {
      const result = extractIssueRefsWithContext('Fixes #1, Closes #2, Resolves #3');
      assert.strictEqual(result.closingRefs.length, 3);
      assert.strictEqual(result.mentionRefs.length, 0);
      assert.strictEqual(result.hasClosingRefs, true);
    });
  });

  describe('buildIssueUrl()', () => {
    it('should build URL from reference with owner/repo', () => {
      const url = buildIssueUrl({ number: 123, owner: 'myorg', repo: 'myrepo', raw: '#123' });
      assert.strictEqual(url, 'https://github.com/myorg/myrepo/issues/123');
    });

    it('should use default owner/repo when not in reference', () => {
      const url = buildIssueUrl({ number: 456, raw: '#456' }, 'defaultOrg', 'defaultRepo');
      assert.strictEqual(url, 'https://github.com/defaultOrg/defaultRepo/issues/456');
    });

    it('should throw error when owner/repo missing', () => {
      assert.throws(
        () => buildIssueUrl({ number: 789, raw: '#789' }),
        /Cannot build issue URL: missing owner or repo/
      );
    });

    it('should prefer reference owner/repo over defaults', () => {
      const url = buildIssueUrl(
        { number: 100, owner: 'refOwner', repo: 'refRepo', raw: 'refOwner/refRepo#100' },
        'defaultOwner',
        'defaultRepo'
      );
      assert.strictEqual(url, 'https://github.com/refOwner/refRepo/issues/100');
    });
  });

  describe('formatIssueRefs()', () => {
    it('should format simple references', () => {
      const refs = [
        { number: 1, raw: '#1' },
        { number: 2, raw: '#2' },
      ];
      const formatted = formatIssueRefs(refs);
      assert.strictEqual(formatted, '#1, #2');
    });

    it('should format cross-repo references', () => {
      const refs = [
        { number: 1, owner: 'other', repo: 'project', raw: 'other/project#1' },
      ];
      const formatted = formatIssueRefs(refs, 'myorg', 'myrepo');
      assert.strictEqual(formatted, 'other/project#1');
    });

    it('should show short form for same-repo references', () => {
      const refs = [
        { number: 1, owner: 'myorg', repo: 'myrepo', raw: 'myorg/myrepo#1' },
      ];
      const formatted = formatIssueRefs(refs, 'myorg', 'myrepo');
      assert.strictEqual(formatted, '#1');
    });
  });

  describe('hasIssueRefs()', () => {
    it('should return true for text with references', () => {
      assert.strictEqual(hasIssueRefs('See #123'), true);
    });

    it('should return false for text without references', () => {
      assert.strictEqual(hasIssueRefs('No issues here'), false);
    });
  });

  describe('hasClosingRefs()', () => {
    it('should return true for text with closing references', () => {
      assert.strictEqual(hasClosingRefs('Fixes #123'), true);
    });

    it('should return false for text with only mention references', () => {
      assert.strictEqual(hasClosingRefs('refs #123'), false);
    });

    it('should return false for text without references', () => {
      assert.strictEqual(hasClosingRefs('No issues'), false);
    });
  });
});
