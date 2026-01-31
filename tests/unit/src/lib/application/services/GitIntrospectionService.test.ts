/**
 * Tests for GitIntrospectionService
 *
 * Tests git introspection capabilities:
 * - Loading recent git commits with date filtering
 * - Detecting GitHub repository from remote URL formats
 * - Graceful error handling when git is unavailable
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { GitIntrospectionService } from '../../../../../../src/lib/application/services/GitIntrospectionService';
import type { IGitClient } from '../../../../../../src/lib/domain/interfaces/IGitClient';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: mock.fn(() => ''),
    getRemoteUrl: mock.fn(() => ''),
    getDefaultBranch: mock.fn(() => 'main'),
    diff: mock.fn(() => ''),
    refExists: mock.fn(() => true),
    ...overrides,
  } as unknown as IGitClient;
}

// ============================================================================
// Tests
// ============================================================================

describe('GitIntrospectionService', () => {
  let service: GitIntrospectionService;
  let mockGit: IGitClient;

  beforeEach(() => {
    mockGit = createMockGitClient();
    service = new GitIntrospectionService(mockGit);
  });

  // --------------------------------------------------------------------------
  // loadGitCommits
  // --------------------------------------------------------------------------

  describe('loadGitCommits', () => {
    it('should return empty array when since is undefined', async () => {
      const result = await service.loadGitCommits(undefined, '/test/project');

      assert.deepStrictEqual(result, []);
      // git.log should not be called at all when since is undefined
      const logMock = mockGit.log as ReturnType<typeof mock.fn>;
      assert.strictEqual(logMock.mock.callCount(), 0);
    });

    it('should parse git log output into IGitCommit objects', async () => {
      const gitLogOutput = [
        'abc1234 feat: add new feature',
        'def5678 fix: resolve bug in parser',
        'ghi9012 refactor: extract service class',
      ].join('\n');

      mockGit = createMockGitClient({
        log: mock.fn(() => gitLogOutput) as unknown as IGitClient['log'],
      });
      service = new GitIntrospectionService(mockGit);

      const since = new Date('2026-01-15T00:00:00Z');
      const result = await service.loadGitCommits(since, '/test/project');

      assert.strictEqual(result.length, 3);

      assert.deepStrictEqual(result[0], {
        hash: 'abc1234',
        message: 'feat: add new feature',
      });
      assert.deepStrictEqual(result[1], {
        hash: 'def5678',
        message: 'fix: resolve bug in parser',
      });
      assert.deepStrictEqual(result[2], {
        hash: 'ghi9012',
        message: 'refactor: extract service class',
      });
    });

    it('should return empty array when git.log returns empty string', async () => {
      mockGit = createMockGitClient({
        log: mock.fn(() => '') as unknown as IGitClient['log'],
      });
      service = new GitIntrospectionService(mockGit);

      const since = new Date('2026-01-15T00:00:00Z');
      const result = await service.loadGitCommits(since, '/test/project');

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array when git.log throws (git not available)', async () => {
      mockGit = createMockGitClient({
        log: mock.fn(() => {
          throw new Error('git: command not found');
        }) as unknown as IGitClient['log'],
      });
      service = new GitIntrospectionService(mockGit);

      const since = new Date('2026-01-15T00:00:00Z');
      const result = await service.loadGitCommits(since, '/test/project');

      assert.deepStrictEqual(result, []);
    });

    it('should pass correct since format (YYYY-MM-DD) and maxCount (10)', async () => {
      const logFn = mock.fn(() => '') as unknown as IGitClient['log'];
      mockGit = createMockGitClient({ log: logFn });
      service = new GitIntrospectionService(mockGit);

      const since = new Date('2026-01-20T14:30:00Z');
      await service.loadGitCommits(since, '/test/project');

      const logMock = logFn as ReturnType<typeof mock.fn>;
      assert.strictEqual(logMock.mock.callCount(), 1);

      const callArgs = logMock.mock.calls[0].arguments[0] as {
        since: string;
        format: string;
        maxCount: number;
        cwd: string;
      };
      assert.strictEqual(callArgs.since, '2026-01-20');
      assert.strictEqual(callArgs.format, '%h %s');
      assert.strictEqual(callArgs.maxCount, 10);
      assert.strictEqual(callArgs.cwd, '/test/project');
    });

    it('should handle git log output with trailing newlines', async () => {
      const gitLogOutput = 'abc1234 some commit\ndef5678 another commit\n\n';

      mockGit = createMockGitClient({
        log: mock.fn(() => gitLogOutput) as unknown as IGitClient['log'],
      });
      service = new GitIntrospectionService(mockGit);

      const since = new Date('2026-01-15T00:00:00Z');
      const result = await service.loadGitCommits(since, '/test/project');

      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result[0], { hash: 'abc1234', message: 'some commit' });
      assert.deepStrictEqual(result[1], { hash: 'def5678', message: 'another commit' });
    });
  });

  // --------------------------------------------------------------------------
  // detectGitHubRepo
  // --------------------------------------------------------------------------

  describe('detectGitHubRepo', () => {
    it('should parse HTTPS URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'https://github.com/owner/repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, 'owner/repo');
    });

    it('should parse SSH URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'git@github.com:owner/repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, 'owner/repo');
    });

    it('should return null for non-GitHub URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'https://gitlab.com/owner/repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, null);
    });

    it('should return null when getRemoteUrl throws', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => {
          throw new Error('fatal: not a git repository');
        }) as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, null);
    });

    it('should strip .git suffix from HTTPS URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'https://github.com/my-org/my-repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, 'my-org/my-repo');
    });

    it('should strip .git suffix from SSH URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'git@github.com:my-org/my-repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, 'my-org/my-repo');
    });

    it('should handle HTTPS URLs without .git suffix', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'https://github.com/owner/repo') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, 'owner/repo');
    });

    it('should pass origin and projectRoot to getRemoteUrl', async () => {
      const getRemoteUrlFn = mock.fn(() => 'https://github.com/owner/repo.git') as unknown as IGitClient['getRemoteUrl'];
      mockGit = createMockGitClient({ getRemoteUrl: getRemoteUrlFn });
      service = new GitIntrospectionService(mockGit);

      await service.detectGitHubRepo('/my/project/root');

      const remoteMock = getRemoteUrlFn as ReturnType<typeof mock.fn>;
      assert.strictEqual(remoteMock.mock.callCount(), 1);
      assert.strictEqual(remoteMock.mock.calls[0].arguments[0], 'origin');
      assert.strictEqual(remoteMock.mock.calls[0].arguments[1], '/my/project/root');
    });

    it('should return null for Bitbucket URLs', async () => {
      mockGit = createMockGitClient({
        getRemoteUrl: mock.fn(() => 'git@bitbucket.org:owner/repo.git') as unknown as IGitClient['getRemoteUrl'],
      });
      service = new GitIntrospectionService(mockGit);

      const result = await service.detectGitHubRepo('/test/project');

      assert.strictEqual(result, null);
    });
  });
});
