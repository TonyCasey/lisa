import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createGitHubDataFetcher } from '../../../../../../src/lib/infrastructure/github/GitHubDataFetcher';
import type { GithubClient } from '../../../../../../src/lib/infrastructure/github/GithubClient';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces/ILogger';
import { GithubClientError } from '../../../../../../src/lib/infrastructure/github/types';

describe('GitHubDataFetcher', () => {
  let mockGithubClient: GithubClient;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockGithubClient = {
      getPr: mock.fn(async () => ({
        number: 123,
        title: 'Test PR',
        body: 'Test body',
        author: { login: 'testuser' },
        closingIssuesReferences: [],
      })),
      getPrReviewThreads: mock.fn(async () => []),
      getIssue: mock.fn(async () => ({
        number: 456,
        title: 'Test Issue',
        body: 'Issue body',
      })),
      isAvailable: mock.fn(async () => true),
    } as unknown as GithubClient;

    mockLogger = {
      debug: mock.fn(() => {}),
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    } as unknown as ILogger;
  });

  describe('fetchPR', () => {
    it('should fetch PR details and return enriched data', async () => {
      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.number, 123);
      assert.strictEqual(result.title, 'Test PR');
      assert.strictEqual(result.body, 'Test body');
      assert.strictEqual(result.author, 'testuser');
    });

    it('should include review comments from threads', async () => {
      (mockGithubClient.getPrReviewThreads as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        {
          id: 'thread1',
          isResolved: true,
          isOutdated: false,
          comments: {
            nodes: [
              {
                id: 'comment1',
                databaseId: 1,
                body: 'This looks good',
                author: { login: 'reviewer' },
                path: 'src/file.ts',
                line: 10,
              },
            ],
          },
        },
      ]);

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.reviewComments.length, 1);
      assert.strictEqual(result.reviewComments[0].body, 'This looks good');
      assert.strictEqual(result.reviewComments[0].author, 'reviewer');
      assert.strictEqual(result.reviewComments[0].path, 'src/file.ts');
      assert.strictEqual(result.reviewComments[0].isResolved, true);
    });

    it('should fetch linked issues', async () => {
      (mockGithubClient.getPr as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        number: 123,
        title: 'Test PR',
        body: 'Test body',
        author: { login: 'testuser' },
        closingIssuesReferences: [
          { number: 456, title: 'Linked Issue', url: 'https://github.com/owner/repo/issues/456' },
        ],
      }));

      (mockGithubClient.getIssue as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        number: 456,
        title: 'Linked Issue',
        body: 'This is the issue body.',
      }));

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.linkedIssues.length, 1);
      assert.strictEqual(result.linkedIssues[0].number, 456);
      assert.strictEqual(result.linkedIssues[0].body, 'This is the issue body.');
    });

    it('should return null if PR not found', async () => {
      (mockGithubClient.getPr as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new GithubClientError('Not found', 'NOT_FOUND');
      });

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 999);

      assert.strictEqual(result, null);
    });

    it('should return null if not authenticated', async () => {
      (mockGithubClient.getPr as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new GithubClientError('Not authenticated', 'NOT_AUTHENTICATED');
      });

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.strictEqual(result, null);
    });

    it('should continue if review threads fetch fails', async () => {
      (mockGithubClient.getPrReviewThreads as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new Error('API error');
      });

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      // Should still return PR data, just without review comments
      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.reviewComments.length, 0);
    });

    it('should handle issue fetch errors gracefully', async () => {
      (mockGithubClient.getPr as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        number: 123,
        title: 'Test PR',
        body: 'Test body',
        author: { login: 'testuser' },
        closingIssuesReferences: [
          { number: 456, title: 'Linked Issue', url: 'https://github.com/owner/repo/issues/456' },
        ],
      }));

      (mockGithubClient.getIssue as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new Error('Issue fetch failed');
      });

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      // Should still return PR, with minimal issue info
      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.linkedIssues.length, 1);
      assert.strictEqual(result.linkedIssues[0].number, 456);
      assert.strictEqual(result.linkedIssues[0].body, '');  // Empty body on error
    });

    it('should handle null PR body', async () => {
      (mockGithubClient.getPr as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        number: 123,
        title: 'Test PR',
        body: null,  // Some PRs have null body
        author: { login: 'testuser' },
        closingIssuesReferences: [],
      }));

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.body, '');
    });

    it('should handle null author in comments', async () => {
      (mockGithubClient.getPrReviewThreads as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        {
          id: 'thread1',
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [
              {
                id: 'comment1',
                databaseId: 1,
                body: 'Comment',
                author: null,  // Deleted user
                path: 'src/file.ts',
                line: 10,
              },
            ],
          },
        },
      ]);

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
      assert.strictEqual(result.reviewComments[0].author, 'unknown');
    });
  });

  describe('isAvailable', () => {
    it('should return true when client is available', async () => {
      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.isAvailable();

      assert.strictEqual(result, true);
    });

    it('should return false when client is not available', async () => {
      (mockGithubClient.isAvailable as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => false);

      const fetcher = createGitHubDataFetcher(mockGithubClient, mockLogger);
      const result = await fetcher.isAvailable();

      assert.strictEqual(result, false);
    });
  });

  describe('without logger', () => {
    it('should work without logger', async () => {
      const fetcher = createGitHubDataFetcher(mockGithubClient);  // No logger
      const result = await fetcher.fetchPR('owner/repo', 123);

      assert.ok(result, 'Should return enriched PR');
    });
  });
});
