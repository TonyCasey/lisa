import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createGitExtractorService } from '../../../../../../src/lib/application/services/GitExtractorService';
import type {
  IGitHubDataFetcher,
  IEnrichedPR,
  IReviewComment,
  ILinkedIssue,
} from '../../../../../../src/lib/domain/interfaces/IGitExtractor';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces/ILogger';

describe('GitExtractorService', () => {
  let mockDataFetcher: IGitHubDataFetcher;
  let mockLogger: ILogger;

  const createMockPR = (overrides: Partial<IEnrichedPR> = {}): IEnrichedPR => ({
    number: 123,
    title: 'Test PR',
    body: 'This is a test PR body.',
    author: 'testuser',
    reviewComments: [],
    linkedIssues: [],
    ...overrides,
  });

  beforeEach(() => {
    mockDataFetcher = {
      fetchPR: mock.fn(async () => null),
      isAvailable: mock.fn(async () => true),
    };

    mockLogger = {
      debug: mock.fn(() => {}),
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    } as unknown as ILogger;
  });

  describe('extractFromPRs', () => {
    it('should return empty result for empty PR numbers array', async () => {
      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([], 'owner/repo');

      assert.strictEqual(result.prsProcessed, 0);
      assert.strictEqual(result.prsSkipped, 0);
      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.patternsMatched, 0);
    });

    it('should skip PRs that fail to fetch', async () => {
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => null);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123, 456], 'owner/repo');

      assert.strictEqual(result.prsProcessed, 0);
      assert.strictEqual(result.prsSkipped, 2);
    });

    it('should skip PRs in skipPRs option', async () => {
      const mockPR = createMockPR({ number: 123 });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (repo: string, prNumber: number) => prNumber === 123 ? mockPR : null
      );

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123, 456], 'owner/repo', { skipPRs: [123] });

      // Should only try to fetch PR 456, and skip 123
      assert.strictEqual(result.prsSkipped, 2);  // 123 skipped by option, 456 returns null
    });

    it('should limit PRs to maxPRs option', async () => {
      const mockFetchPR = mock.fn(async () => createMockPR());
      mockDataFetcher.fetchPR = mockFetchPR;

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      await service.extractFromPRs([1, 2, 3, 4, 5], 'owner/repo', { maxPRs: 2 });

      // Should only fetch 2 PRs
      assert.strictEqual(mockFetchPR.mock.calls.length, 2);
    });

    it('should extract decision facts from PR body', async () => {
      const mockPR = createMockPR({
        body: 'We decided to use TypeScript because it provides better type safety and developer experience.',
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      assert.strictEqual(result.prsProcessed, 1);
      assert.ok(result.facts.length > 0, 'Should extract facts');

      const decisionFact = result.facts.find(f => f.type === 'decision');
      assert.ok(decisionFact, 'Should find a decision fact');
      assert.strictEqual(decisionFact.source, 'pr-description');
      assert.strictEqual(decisionFact.prNumber, 123);
    });

    it('should extract gotcha facts from review comments', async () => {
      const mockPR = createMockPR({
        reviewComments: [
          {
            id: 1,
            author: 'reviewer',
            body: 'Careful: this function can throw if the input is null.',
            isResolved: false,
          },
        ],
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      const gotchaFact = result.facts.find(f => f.type === 'gotcha');
      assert.ok(gotchaFact, 'Should find a gotcha fact');
      assert.strictEqual(gotchaFact.source, 'review-comment');
    });

    it('should boost confidence for resolved review comments', async () => {
      const mockPR = createMockPR({
        reviewComments: [
          {
            id: 1,
            author: 'reviewer',
            body: 'Careful: make sure to validate the input before processing.',
            isResolved: true,  // Resolved means feedback was accepted
          },
        ],
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      const gotchaFact = result.facts.find(f => f.type === 'gotcha');
      if (gotchaFact) {
        // Confidence should be boosted from base level
        assert.ok(['medium', 'high'].includes(gotchaFact.confidence), 'Confidence should be boosted');
      }
    });

    it('should add file path as tag from review comments', async () => {
      const mockPR = createMockPR({
        reviewComments: [
          {
            id: 1,
            author: 'reviewer',
            body: 'Note: this is an important consideration for this file.',
            path: 'src/services/important.ts',
            isResolved: false,
          },
        ],
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      const fact = result.facts.find(f => f.source === 'review-comment');
      if (fact) {
        assert.ok(fact.tags.includes('src/services/important.ts'), 'Should include file path as tag');
      }
    });

    it('should extract from linked issues', async () => {
      const mockPR = createMockPR({
        linkedIssues: [
          {
            number: 456,
            title: 'Feature Request',
            body: 'We need this because it will improve user experience significantly.',
          },
        ],
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      const issueFact = result.facts.find(f => f.source === 'issue-body');
      assert.ok(issueFact, 'Should find a fact from linked issue');
      assert.strictEqual(issueFact.issueNumber, 456);
    });

    it('should filter by extractTypes option', async () => {
      const mockPR = createMockPR({
        body: `
          We decided to use Redis because it is fast.
          Careful: this can fail under high load.
          Always use connection pooling.
        `,
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo', {
        extractTypes: ['decision'],  // Only extract decisions
      });

      // Should only have decision facts
      assert.ok(result.facts.every(f => f.type === 'decision'), 'Should only have decision facts');
    });

    it('should filter by minConfidence option', async () => {
      const mockPR = createMockPR({
        body: 'Note: something. Careful: this is very important and should be highlighted prominently.',
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);

      // With high minimum confidence
      const highResult = await service.extractFromPRs([123], 'owner/repo', {
        minConfidence: 'high',
      });

      // With low minimum confidence
      const lowResult = await service.extractFromPRs([123], 'owner/repo', {
        minConfidence: 'low',
      });

      // Low confidence should include more facts (or equal)
      assert.ok(lowResult.facts.length >= highResult.facts.length);
    });

    it('should deduplicate identical facts', async () => {
      const mockPR = createMockPR({
        body: 'Because it is faster. Because it is faster.',
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      // Should deduplicate identical text
      const texts = result.facts.map(f => f.text.toLowerCase());
      const uniqueTexts = new Set(texts);
      assert.strictEqual(texts.length, uniqueTexts.size, 'Should not have duplicate facts');
    });

    it('should handle PR fetch errors gracefully', async () => {
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new Error('Network error');
      });

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      assert.strictEqual(result.prsProcessed, 0);
      assert.strictEqual(result.prsSkipped, 1);
      assert.strictEqual(result.facts.length, 0);
    });

    it('should include matched pattern name in fact', async () => {
      const mockPR = createMockPR({
        body: 'We decided to use this approach for better performance.',
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      if (result.facts.length > 0) {
        assert.ok(result.facts[0].matchedPattern, 'Should include matched pattern name');
      }
    });

    it('should extract technology tags from text', async () => {
      const mockPR = createMockPR({
        body: 'We decided to use TypeScript and GraphQL because they work well together.',
      });
      (mockDataFetcher.fetchPR as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => mockPR);

      const service = createGitExtractorService(mockDataFetcher, mockLogger);
      const result = await service.extractFromPRs([123], 'owner/repo');

      // Should have extracted at least one fact (the "decided to use" pattern)
      assert.ok(result.facts.length > 0, 'Expected facts to be extracted');

      // Check if any fact has technology tags
      const allTags = result.facts.flatMap(f => f.tags);
      const hasTechTags = allTags.some(t =>
        ['typescript', 'graphql', 'react', 'node'].includes(t.toLowerCase())
      );

      assert.ok(hasTechTags, 'Expected technology tags to be extracted');
    });
  });

  describe('without logger', () => {
    it('should work without logger', async () => {
      const service = createGitExtractorService(mockDataFetcher);  // No logger
      const result = await service.extractFromPRs([], 'owner/repo');

      assert.strictEqual(result.prsProcessed, 0);
    });
  });
});
