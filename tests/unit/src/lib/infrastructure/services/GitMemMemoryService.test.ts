import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GitMemMemoryService } from '../../../../../../src/lib/infrastructure/services/GitMemMemoryService';
import type { IMemoryService as IGitMemMemoryService, IMemoryEntity } from 'git-mem';

function createMockEntity(overrides: Partial<IMemoryEntity> = {}): IMemoryEntity {
  return {
    id: 'test-uuid-1',
    content: 'Test memory content',
    type: 'fact',
    sha: 'abc123',
    confidence: 'high',
    source: 'user-explicit',
    lifecycle: 'project',
    tags: ['group:test-group'],
    createdAt: '2026-02-06T10:00:00.000Z',
    updatedAt: '2026-02-06T10:00:00.000Z',
    ...overrides,
  };
}

function createMockGitMem(): IGitMemMemoryService & {
  recall: ReturnType<typeof mock.fn>;
  remember: ReturnType<typeof mock.fn>;
  get: ReturnType<typeof mock.fn>;
  delete: ReturnType<typeof mock.fn>;
} {
  return {
    recall: mock.fn(() => ({ memories: [], total: 0 })),
    remember: mock.fn(() => createMockEntity()),
    get: mock.fn(() => null),
    delete: mock.fn(() => false),
  };
}

describe('GitMemMemoryService', () => {
  let service: GitMemMemoryService;
  let mockGitMem: ReturnType<typeof createMockGitMem>;

  beforeEach(() => {
    mockGitMem = createMockGitMem();
    service = new GitMemMemoryService(mockGitMem);
  });

  describe('loadMemory', () => {
    it('should return facts mapped from git-mem entities', async () => {
      const entity = createMockEntity({ content: 'Important decision' });
      mockGitMem.recall = mock.fn(() => ({ memories: [entity], total: 1 }));

      const result = await service.loadMemory();

      assert.equal(result.facts.length, 1);
      assert.equal(result.facts[0]?.uuid, 'test-uuid-1');
      assert.equal(result.facts[0]?.fact, 'Important decision');
      assert.equal(result.facts[0]?.name, 'Important decision');
      assert.equal(result.facts[0]?.created_at, '2026-02-06T10:00:00.000Z');
      assert.equal(result.timedOut, false);
      assert.equal(result.nodes.length, 0);
      assert.equal(result.tasks.length, 0);
    });

    it('should extract init-review as separate field', async () => {
      const regular = createMockEntity({ id: 'regular', content: 'A fact' });
      const initReview = createMockEntity({
        id: 'review',
        content: 'Codebase review content',
        tags: ['init-review'],
      });
      mockGitMem.recall = mock.fn(() => ({
        memories: [regular, initReview],
        total: 2,
      }));

      const result = await service.loadMemory();

      assert.equal(result.facts.length, 1);
      assert.equal(result.facts[0]?.uuid, 'regular');
      assert.equal(result.initReview, 'Codebase review content');
    });

    it('should return all facts from git-mem', async () => {
      const e1 = createMockEntity({ id: '1', tags: [] });
      const e2 = createMockEntity({ id: '2', tags: ['sometag'] });
      mockGitMem.recall = mock.fn(() => ({ memories: [e1, e2], total: 2 }));

      const result = await service.loadMemory();

      assert.equal(result.facts.length, 2);
    });
  });

  describe('loadFactsDateOrdered', () => {
    it('should return mapped facts with limit', async () => {
      const entities = [
        createMockEntity({ id: '1', content: 'First' }),
        createMockEntity({ id: '2', content: 'Second' }),
      ];
      mockGitMem.recall = mock.fn(() => ({ memories: entities, total: 2 }));

      const result = await service.loadFactsDateOrdered(5);

      assert.equal(result.length, 2);
      assert.equal(mockGitMem.recall.mock.calls[0]?.arguments[1]?.limit, 5);
    });

    it('should filter by since date', async () => {
      const old = createMockEntity({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
      const recent = createMockEntity({ id: 'recent', createdAt: '2026-02-06T12:00:00.000Z' });
      mockGitMem.recall = mock.fn(() => ({ memories: [old, recent], total: 2 }));

      const result = await service.loadFactsDateOrdered(10, {
        since: new Date('2026-02-01'),
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.uuid, 'recent');
    });

    it('should filter by until date', async () => {
      const old = createMockEntity({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
      const recent = createMockEntity({ id: 'recent', createdAt: '2026-02-06T12:00:00.000Z' });
      mockGitMem.recall = mock.fn(() => ({ memories: [old, recent], total: 2 }));

      const result = await service.loadFactsDateOrdered(10, {
        until: new Date('2026-01-15'),
      });

      assert.equal(result.length, 1);
      assert.equal(result[0]?.uuid, 'old');
    });
  });

  describe('searchFacts', () => {
    it('should pass query to git-mem recall', async () => {
      const entity = createMockEntity({ content: 'TypeScript config' });
      mockGitMem.recall = mock.fn(() => ({ memories: [entity], total: 1 }));

      const result = await service.searchFacts('typescript');

      assert.equal(result.length, 1);
      assert.equal(mockGitMem.recall.mock.calls[0]?.arguments[0], 'typescript');
    });

    it('should respect limit parameter', async () => {
      mockGitMem.recall = mock.fn(() => ({ memories: [], total: 0 }));

      await service.searchFacts('query', 5);

      assert.equal(mockGitMem.recall.mock.calls[0]?.arguments[1]?.limit, 5);
    });
  });

  describe('saveMemory', () => {
    it('should call remember for each fact', async () => {
      await service.saveMemory(['Fact 1', 'Fact 2', 'Fact 3']);

      assert.equal(mockGitMem.remember.mock.callCount(), 3);
      assert.equal(mockGitMem.remember.mock.calls[0]?.arguments[0], 'Fact 1');
    });
  });

  describe('addFact', () => {
    it('should call remember', async () => {
      await service.addFact('A new fact');

      assert.equal(mockGitMem.remember.mock.callCount(), 1);
      assert.equal(mockGitMem.remember.mock.calls[0]?.arguments[0], 'A new fact');
    });

    it('should include additional tags', async () => {
      await service.addFact('Tagged fact', ['feature', 'auth']);

      const tags = mockGitMem.remember.mock.calls[0]?.arguments[1]?.tags as string[];
      assert.ok(tags.includes('feature'));
      assert.ok(tags.includes('auth'));
    });
  });

  describe('addFactWithLifecycle', () => {
    it('should pass lifecycle and confidence as tags', async () => {
      await service.addFactWithLifecycle('Session fact', {
        lifecycle: 'session',
        confidence: 'medium',
        sourceType: 'session-capture',
      });

      assert.equal(mockGitMem.remember.mock.callCount(), 1);
      const opts = mockGitMem.remember.mock.calls[0]?.arguments[1];
      const tags = opts?.tags as string[];
      assert.ok(tags.includes('lifecycle:session'));
      assert.ok(tags.includes('confidence:medium'));
      assert.ok(tags.includes('source:session-capture'));
      assert.equal(opts?.lifecycle, 'session');
      assert.equal(opts?.confidence, 'medium');
    });

    it('should merge option tags without duplicates', async () => {
      await service.addFactWithLifecycle('Fact', {
        lifecycle: 'project',
        tags: ['custom-tag', 'lifecycle:project'],
      });

      const tags = mockGitMem.remember.mock.calls[0]?.arguments[1]?.tags as string[];
      const lifecycleTags = tags.filter(t => t === 'lifecycle:project');
      assert.equal(lifecycleTags.length, 1);
      assert.ok(tags.includes('custom-tag'));
    });
  });

  describe('expireFact', () => {
    it('should call git-mem delete with uuid', async () => {
      await service.expireFact('uuid-to-delete');

      assert.equal(mockGitMem.delete.mock.callCount(), 1);
      assert.equal(mockGitMem.delete.mock.calls[0]?.arguments[0], 'uuid-to-delete');
    });
  });

  describe('cleanupExpired', () => {
    it('should return 0 (not supported)', async () => {
      const result = await service.cleanupExpired();

      assert.equal(result, 0);
    });
  });
});
