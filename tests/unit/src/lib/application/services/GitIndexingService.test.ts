import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createGitIndexingService } from '../../../../../../src/lib/application/services/GitIndexingService';
import type { IMemoryService } from '../../../../../../src/lib/domain/interfaces/IMemoryService';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces/ILogger';
import type { IHeuristicFact } from '../../../../../../src/lib/domain/interfaces/IGitExtractor';

describe('GitIndexingService', () => {
  let mockMemory: IMemoryService;
  let mockLogger: ILogger;

  const createMockFact = (overrides: Partial<IHeuristicFact> = {}): IHeuristicFact => ({
    text: 'Test fact about a decision',
    type: 'decision',
    source: 'pr-description',
    confidence: 'medium',
    tags: ['typescript', 'refactoring'],
    prNumber: 123,
    ...overrides,
  });

  beforeEach(() => {
    mockMemory = {
      addFactWithLifecycle: mock.fn(async () => {}),
      searchFacts: mock.fn(async () => []),
      addFact: mock.fn(async () => {}),
      loadMemory: mock.fn(async () => ({ facts: [], tasks: [], timedOut: false })),
      loadFactsDateOrdered: mock.fn(async () => []),
      saveMemory: mock.fn(async () => {}),
      expireFact: mock.fn(async () => {}),
      cleanupExpired: mock.fn(async () => 0),
    } as unknown as IMemoryService;

    mockLogger = {
      debug: mock.fn(() => {}),
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    } as unknown as ILogger;
  });

  describe('indexFacts', () => {
    it('should index facts with proper quality tags', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 1);
      assert.strictEqual(result.skipped, 0);
      assert.strictEqual(result.duplicates, 0);

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(addFactCalls.length, 1);

      const [groupId, factText, options] = addFactCalls[0].arguments;
      assert.strictEqual(groupId, 'test-group');
      assert.strictEqual(factText, 'Test fact about a decision');
      assert.strictEqual(options.lifecycle, 'project');

      // Verify quality tags
      const tags = options.tags as string[];
      assert.ok(tags.includes('source:code-analysis'), 'Should have source:code-analysis tag');
      assert.ok(tags.includes('confidence:medium'), 'Should have confidence:medium tag');
      assert.ok(tags.includes('lifecycle:project'), 'Should have lifecycle:project tag');
      assert.ok(tags.includes('type:heuristic-extraction'), 'Should have type:heuristic-extraction tag for dedupe');
      assert.ok(tags.includes('factType:decision'), 'Should have factType:decision tag');
      assert.ok(tags.includes('pr:123'), 'Should have pr:123 tag');
      assert.ok(tags.includes('extractionMethod:heuristic'), 'Should have extractionMethod:heuristic tag');
    });

    it('should include commit SHA and issue number in tags when present', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact({
        commitSha: 'abc123',
        issueNumber: 456,
      })];

      await service.indexFacts(facts, 'test-group');

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const options = addFactCalls[0].arguments[2];
      const tags = options.tags as string[];

      assert.ok(tags.includes('commit:abc123'), 'Should have commit tag');
      assert.ok(tags.includes('issue:456'), 'Should have issue tag');
    });

    it('should map feat commit type to milestone memory type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      await service.indexFacts(facts, 'test-group', { conventionalType: 'feat' });

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('memoryType:milestone'), 'Should have memoryType:milestone tag');
    });

    it('should map fix commit type to gotcha memory type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      await service.indexFacts(facts, 'test-group', { conventionalType: 'fix' });

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('memoryType:gotcha'), 'Should have memoryType:gotcha tag');
    });

    it('should map refactor commit type to decision memory type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      await service.indexFacts(facts, 'test-group', { conventionalType: 'refactor' });

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('memoryType:decision'), 'Should have memoryType:decision tag');
    });

    it('should map docs commit type to convention memory type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      await service.indexFacts(facts, 'test-group', { conventionalType: 'docs' });

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('memoryType:convention'), 'Should have memoryType:convention tag');
    });

    it('should skip indexing for chore commit type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact(), createMockFact()];

      const result = await service.indexFacts(facts, 'test-group', { conventionalType: 'chore' });

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 2);
      assert.strictEqual(result.duplicates, 0);

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(addFactCalls.length, 0, 'Should not call addFactWithLifecycle for chore');
    });

    it('should skip indexing for ci commit type', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group', { conventionalType: 'ci' });

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 1);
    });

    it('should detect duplicate facts based on similarity', async () => {
      (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        { fact: 'Test fact about a decision', tags: [] },
      ]);

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.duplicates, 1);
    });

    it('should index facts that are not duplicates', async () => {
      (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        { fact: 'Completely different content about something else', tags: [] },
      ]);

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 1);
      assert.strictEqual(result.duplicates, 0);
    });

    it('should skip deduplication when skipDeduplication is true', async () => {
      (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        { fact: 'Test fact about a decision', tags: [] },
      ]);

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group', { skipDeduplication: true });

      assert.strictEqual(result.indexed, 1);
      assert.strictEqual(result.duplicates, 0);

      // searchFacts should not be called when skipping deduplication
      const searchCalls = (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(searchCalls.length, 0);
    });

    it('should use custom similarity threshold', async () => {
      (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        { fact: 'Test fact about some decision', tags: [] },  // Similar but not exact
      ]);

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      // With high threshold (0.99), should not be considered duplicate
      const result1 = await service.indexFacts(facts, 'test-group', { similarityThreshold: 0.99 });
      assert.strictEqual(result1.indexed, 1);
      assert.strictEqual(result1.duplicates, 0);
    });

    it('should handle multiple facts and prevent within-batch duplicates', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [
        createMockFact({ text: 'First fact about testing' }),
        createMockFact({ text: 'Second fact about coding' }),
        createMockFact({ text: 'First fact about testing' }),  // Duplicate within batch
      ];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 2);
      assert.strictEqual(result.duplicates, 1);
    });

    it('should continue indexing when one fact fails', async () => {
      let callCount = 0;
      (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Save failed');
        }
      });

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [
        createMockFact({ text: 'Fact 1' }),
        createMockFact({ text: 'Fact 2' }),  // This will fail
        createMockFact({ text: 'Fact 3' }),
      ];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 2);
      assert.strictEqual(result.skipped, 1);
    });

    it('should handle searchFacts failure gracefully', async () => {
      (mockMemory.searchFacts as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        throw new Error('Search failed');
      });

      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact()];

      // Should not throw, should continue without deduplication
      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 1);
    });

    it('should include matched pattern in tags', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact({
        matchedPattern: 'decision-keyword',
      })];

      await service.indexFacts(facts, 'test-group');

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('pattern:decision-keyword'), 'Should have pattern tag');
    });

    it('should prefix original fact tags with tag:', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);
      const facts = [createMockFact({
        tags: ['typescript', 'authentication'],
      })];

      await service.indexFacts(facts, 'test-group');

      const addFactCalls = (mockMemory.addFactWithLifecycle as ReturnType<typeof mock.fn>).mock.calls;
      const tags = addFactCalls[0].arguments[2].tags as string[];

      assert.ok(tags.includes('tag:typescript'), 'Should have prefixed tag:typescript');
      assert.ok(tags.includes('tag:authentication'), 'Should have prefixed tag:authentication');
    });
  });

  describe('without logger', () => {
    it('should work without logger', async () => {
      const service = createGitIndexingService(mockMemory);  // No logger
      const facts = [createMockFact()];

      const result = await service.indexFacts(facts, 'test-group');

      assert.strictEqual(result.indexed, 1);
    });
  });

  describe('empty facts', () => {
    it('should handle empty facts array', async () => {
      const service = createGitIndexingService(mockMemory, mockLogger);

      const result = await service.indexFacts([], 'test-group');

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 0);
      assert.strictEqual(result.duplicates, 0);
    });
  });
});
