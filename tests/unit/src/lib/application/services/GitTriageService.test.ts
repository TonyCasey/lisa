/**
 * Tests for GitTriageService
 *
 * Tests git history triage capabilities:
 * - Scoring commits for "interestingness"
 * - Detecting interest signals (conventional commits, merge commits, etc.)
 * - Calculating triage threshold
 * - Handling edge cases and empty repos
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { GitTriageService } from '../../../../../../src/lib/application/services/GitTriageService';
import type {
  IGitClient,
  IGitLogCommit,
  IGitCommitStatEntry,
  IGitTag,
} from '../../../../../../src/lib/domain/interfaces/IGitClient';
import type { IGitCommitData, IGitCommitStats } from '../../../../../../src/lib/domain/interfaces/IGitTriageService';

// ============================================================================
// Test Data Factories
// ============================================================================

function createMockCommit(overrides: Partial<IGitLogCommit> = {}): IGitLogCommit {
  return {
    sha: 'abc123def456789',
    shortSha: 'abc123d',
    parentShas: ['parent1'],
    subject: 'feat: add new feature',
    body: '',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    authorTimestamp: Math.floor(Date.now() / 1000),
    refNames: '',
    ...overrides,
  };
}

function createMockStats(overrides: Partial<{
  filesChanged: number;
  insertions: number;
  deletions: number;
}> = {}): IGitCommitStatEntry[] {
  const count = overrides.filesChanged ?? 3;
  const entries: IGitCommitStatEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      added: Math.floor((overrides.insertions ?? 50) / count),
      deleted: Math.floor((overrides.deletions ?? 20) / count),
      path: `src/file${i}.ts`,
      isNew: false,
      isDeleted: false,
    });
  }
  return entries;
}

function createMockGitClient(overrides: Partial<{
  commits: IGitLogCommit[];
  stats: Map<string, IGitCommitStatEntry[]>;
  tags: IGitTag[];
}> = {}): IGitClient {
  const commits = overrides.commits ?? [];
  const stats = overrides.stats ?? new Map();
  const tags = overrides.tags ?? [];

  return {
    log: mock.fn(() => ''),
    getRemoteUrl: mock.fn(() => ''),
    getDefaultBranch: mock.fn(() => 'main'),
    diff: mock.fn(() => ''),
    refExists: mock.fn(() => true),
    logDetailed: mock.fn(() => commits),
    getCommitStats: mock.fn((sha: string) => stats.get(sha) ?? []),
    listTags: mock.fn(() => tags),
    countCommits: mock.fn(() => commits.length),
  } as unknown as IGitClient;
}

// ============================================================================
// Tests
// ============================================================================

describe('GitTriageService', () => {
  let service: GitTriageService;
  let mockGit: IGitClient;

  beforeEach(() => {
    mockGit = createMockGitClient();
    service = new GitTriageService(mockGit);
  });

  // --------------------------------------------------------------------------
  // triage - Basic Functionality
  // --------------------------------------------------------------------------

  describe('triage', () => {
    it('should return empty result when no commits in range', async () => {
      mockGit = createMockGitClient({ commits: [] });
      service = new GitTriageService(mockGit);

      const result = await service.triage();

      assert.strictEqual(result.totalCommits, 0);
      assert.strictEqual(result.highInterest.length, 0);
      assert.strictEqual(result.belowThreshold, 0);
      assert.ok(result.durationMs >= 0);
    });

    it('should score commits and separate by threshold', async () => {
      const commits = [
        // High interest: merge commit with PR (score 3+)
        createMockCommit({
          sha: 'merge1',
          shortSha: 'merge1',
          parentShas: ['p1', 'p2'],
          subject: 'Merge pull request #42 from feature/branch',
        }),
        // Low interest: simple chore commit (score ~1)
        createMockCommit({
          sha: 'chore1',
          shortSha: 'chore1',
          subject: 'chore: update dependencies',
        }),
        // High interest: conventional feat with long body (score 2+)
        createMockCommit({
          sha: 'feat1',
          shortSha: 'feat1',
          subject: 'feat: add migration to new database',
          body: 'This commit migrates the database schema.\nMultiple changes included.',
        }),
      ];

      mockGit = createMockGitClient({ commits });
      service = new GitTriageService(mockGit);

      const result = await service.triage({ threshold: 3 });

      assert.strictEqual(result.totalCommits, 3);
      // Merge commit with PR should pass threshold
      assert.ok(result.highInterest.length >= 1, 'Should have at least one high-interest commit');

      // Verify the merge commit is in high interest
      const mergeCommit = result.highInterest.find(c => c.commit.sha === 'merge1');
      assert.ok(mergeCommit, 'Merge commit should be in high interest');
      assert.strictEqual(mergeCommit.signals.mergeCommitWithPR, true);
      assert.strictEqual(mergeCommit.signals.prNumber, 42);
    });

    it('should respect maxCommits option', async () => {
      const commits = Array.from({ length: 10 }, (_, i) =>
        createMockCommit({ sha: `commit${i}`, shortSha: `c${i}` })
      );

      const logDetailedFn = mock.fn(() => commits.slice(0, 5));
      mockGit = createMockGitClient({ commits });
      (mockGit as { logDetailed: typeof logDetailedFn }).logDetailed = logDetailedFn;
      service = new GitTriageService(mockGit);

      await service.triage({ maxCommits: 5 });

      const calls = (logDetailedFn as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].arguments[0].maxCount, 5);
    });
  });

  // --------------------------------------------------------------------------
  // scoreCommit - Interest Signals Detection
  // --------------------------------------------------------------------------

  describe('scoreCommit', () => {
    it('should detect conventional commit prefix', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add new feature',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasConventionalPrefix, true);
      assert.strictEqual(result.signals.conventionalType, 'feat');
      assert.ok(result.score >= 1);
    });

    it('should detect fix prefix', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'fix: resolve null pointer exception',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasConventionalPrefix, true);
      assert.strictEqual(result.signals.conventionalType, 'fix');
    });

    it('should detect refactor prefix', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'refactor(auth): extract service class',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasConventionalPrefix, true);
      assert.strictEqual(result.signals.conventionalType, 'refactor');
    });

    it('should detect merge commit with PR number', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'Merge pull request #123 from feature/branch',
        body: '',
        parentCount: 2,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.mergeCommitWithPR, true);
      assert.strictEqual(result.signals.prNumber, 123);
      assert.ok(result.score >= 3);
    });

    it('should detect PR number in parentheses format', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add new feature (#456)',
        body: '',
        parentCount: 2,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.prNumber, 456);
    });

    it('should detect decision keywords', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: migrate from MySQL to PostgreSQL',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasDecisionKeywords, true);
      assert.ok(result.score >= 2);
    });

    it('should detect decision keywords in body', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'refactor: update auth system',
        body: 'This is a breaking change that deprecates the old API.',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasDecisionKeywords, true);
    });

    it('should detect long message body', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add feature',
        body: 'Line 1 of explanation.\nLine 2 with more details.\nLine 3 with context.',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasLongMessageBody, true);
    });

    it('should detect large diff (files)', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'refactor: reorganize project structure',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const stats: IGitCommitStats = {
        filesChanged: 15,
        insertions: 200,
        deletions: 100,
        filesAdded: [],
        filesDeleted: [],
        directoriesCreated: [],
      };

      const result = service.scoreCommit(commitData, stats, new Set());

      assert.strictEqual(result.signals.largeDiffFiles, true);
      assert.ok(result.score >= 3);
    });

    it('should detect large diff (lines)', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add comprehensive feature',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const stats: IGitCommitStats = {
        filesChanged: 3,
        insertions: 400,
        deletions: 150,
        filesAdded: [],
        filesDeleted: [],
        directoriesCreated: [],
      };

      const result = service.scoreCommit(commitData, stats, new Set());

      assert.strictEqual(result.signals.largeDiffLines, true);
      assert.ok(result.score >= 2);
    });

    it('should detect new directory creation', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add new module',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const stats: IGitCommitStats = {
        filesChanged: 5,
        insertions: 200,
        deletions: 0,
        filesAdded: ['newmodule/index.ts', 'newmodule/service.ts'],
        filesDeleted: [],
        directoriesCreated: ['newmodule'],
      };

      const result = service.scoreCommit(commitData, stats, new Set());

      assert.strictEqual(result.signals.createsNewDirectory, true);
      assert.ok(result.score >= 2);
    });

    it('should handle tag-adjacent commits', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'chore: prepare release',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: ['tag: v1.0.0'],
      };

      const tagShas = new Set(['abc123']);
      const result = service.scoreCommit(commitData, null, tagShas);

      assert.strictEqual(result.signals.isTagAdjacent, true);
      assert.ok(result.score >= 2);
    });

    it('should not pass triage for low-score commits', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'update readme',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.passedTriage, false);
    });

    it('should accumulate scores from multiple signals', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'Merge pull request #99 from feature/migrate-db',
        body: 'Migration from old database.\nMultiple schema changes.',
        parentCount: 2,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const stats: IGitCommitStats = {
        filesChanged: 12,
        insertions: 600,
        deletions: 200,
        filesAdded: ['migrations/001.sql'],
        filesDeleted: [],
        directoriesCreated: ['migrations'],
      };

      const result = service.scoreCommit(commitData, stats, new Set());

      // Should have: mergeWithPR(3) + decisionKeywords(2) + longBody(1) + largeDiffFiles(3) + largeDiffLines(2) + newDir(2)
      assert.ok(result.score >= 10, `Expected score >= 10, got ${result.score}`);
      assert.strictEqual(result.passedTriage, true);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle commits with empty body', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: quick fix',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasLongMessageBody, false);
    });

    it('should handle non-conventional commit messages', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'Updated the thing',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.hasConventionalPrefix, false);
      assert.strictEqual(result.signals.conventionalType, null);
    });

    it('should handle single-parent commits (not merge)', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: normal commit (#50)',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      // Has PR number but only one parent, so not a merge commit
      assert.strictEqual(result.signals.mergeCommitWithPR, false);
      assert.strictEqual(result.signals.prNumber, 50);
    });

    it('should handle null stats gracefully', () => {
      const commitData: IGitCommitData = {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'feat: add feature',
        body: '',
        parentCount: 1,
        author: 'Test',
        authorEmail: 'test@example.com',
        timestamp: new Date(),
        refs: [],
      };

      const result = service.scoreCommit(commitData, null, new Set());

      assert.strictEqual(result.signals.largeDiffFiles, false);
      assert.strictEqual(result.signals.largeDiffLines, false);
      assert.strictEqual(result.signals.createsNewDirectory, false);
      assert.strictEqual(result.stats, null);
    });
  });

  // --------------------------------------------------------------------------
  // Tags and Hotspots
  // --------------------------------------------------------------------------

  describe('tags and hotspots', () => {
    it('should include tags in result', async () => {
      const tags: IGitTag[] = [
        { name: 'v1.0.0', sha: 'tag1sha' },
        { name: 'v1.1.0', sha: 'tag2sha' },
        { name: 'release-2.0', sha: 'tag3sha' },
      ];

      mockGit = createMockGitClient({ commits: [], tags });
      service = new GitTriageService(mockGit);

      const result = await service.triage();

      assert.strictEqual(result.tags.length, 3);
      assert.strictEqual(result.tags[0].name, 'v1.0.0');
      assert.strictEqual(result.tags[0].isVersionTag, true);
      assert.strictEqual(result.tags[2].name, 'release-2.0');
      assert.strictEqual(result.tags[2].isVersionTag, false);
    });

    it('should track file hotspots', async () => {
      const commits = [
        createMockCommit({
          sha: 'commit1',
          shortSha: 'c1',
          subject: 'Merge pull request #1 from feature',
          parentShas: ['p1', 'p2'],
        }),
      ];

      const stats = new Map<string, IGitCommitStatEntry[]>();
      stats.set('commit1', [
        { added: 100, deleted: 20, path: 'src/hot.ts', isNew: false, isDeleted: false },
        { added: 50, deleted: 10, path: 'src/warm.ts', isNew: false, isDeleted: false },
      ]);

      mockGit = createMockGitClient({ commits, stats });
      service = new GitTriageService(mockGit);

      const result = await service.triage({ threshold: 1 });

      // Hotspots are tracked for high-interest commits
      assert.ok(result.hotspots.length > 0 || result.highInterest.length === 0);
    });
  });
});
