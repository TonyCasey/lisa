/**
 * Tests for MemoryService quality methods.
 *
 * Tests addFactWithLifecycle with quality metadata (confidence, source),
 * verifyFact, loadFactsByConfidence, and findConflicts.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { MemoryService } from '../../../../../../src/lib/infrastructure/services/MemoryService';
import type { IMcpClient, ILogger, IMemoryItem } from '../../../../../../src/lib/domain';
import type { IRepositoryRouter, IConflictGroup } from '../../../../../../src/lib/domain/interfaces/dal';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockMcpClient(): IMcpClient {
  return {
    call: mock.fn(async () => [{}]),
    getSessionId: mock.fn(() => 'test-session'),
    connect: mock.fn(async () => undefined),
    disconnect: mock.fn(async () => undefined),
    isConnected: mock.fn(async () => true),
  } as unknown as IMcpClient;
}

function createMockLogger(): ILogger {
  const logger: ILogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger,
    isLevelEnabled: () => true,
    logEvent: () => {},
    logEventWarn: () => {},
    startOperation: () => () => {},
  } as unknown as ILogger;
  return logger;
}

function createMockRouter(overrides: Partial<IRepositoryRouter> = {}): IRepositoryRouter {
  const mockRepo = {
    findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const, hasMore: false })),
    search: mock.fn(async () => ({ items: [], source: 'neo4j' as const, hasMore: false })),
    findByTags: mock.fn(async () => ({ items: [], source: 'neo4j' as const, hasMore: false })),
    supportsSemanticSearch: () => false,
    supportsDateOrdering: () => true,
    supportsWrite: () => false,
    expire: mock.fn(async () => undefined),
    expireByFilter: mock.fn(async () => 0),
    save: mock.fn(async () => ({ name: 'test', fact: 'test', created_at: new Date().toISOString() })),
    findByMinConfidence: mock.fn(async () => ({ items: [], source: 'neo4j' as const, hasMore: false })),
    findConflicts: mock.fn(async () => []),
  };

  return {
    getMemoryRepository: mock.fn(() => mockRepo),
    getTaskRepository: mock.fn(() => ({})),
    getPullRequestRepository: mock.fn(() => ({})),
    ...overrides,
  } as unknown as IRepositoryRouter;
}

function createMockItem(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: 'item-1',
    name: 'Test fact',
    fact: 'Test fact content',
    created_at: '2026-01-15T10:00:00.000Z',
    ...overrides,
  } as IMemoryItem;
}

// ============================================================================
// Tests
// ============================================================================

describe('MemoryService - quality', () => {
  let mcp: IMcpClient;
  let logger: ILogger;

  beforeEach(() => {
    mcp = createMockMcpClient();
    logger = createMockLogger();
  });

  describe('addFactWithLifecycle() - quality tags', () => {
    it('should add source tag when sourceType provided', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        tags: ['type:test'],
        sourceType: 'session-capture',
      });

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('source:session-capture'), 'Should include source tag');
    });

    it('should add confidence tag when confidence provided', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'project',
        confidence: 'high',
      });

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('confidence:high'), 'Should include confidence tag');
    });

    it('should auto-derive confidence from sourceType when confidence not explicit', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        sourceType: 'user-explicit',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      // user-explicit defaults to 'high' confidence
      assert.ok(p.tags.includes('confidence:high'), 'Should auto-derive confidence:high for user-explicit');
      assert.ok(p.tags.includes('source:user-explicit'), 'Should include source tag');
    });

    it('should auto-derive low confidence for prompt-capture', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'ephemeral',
        sourceType: 'prompt-capture',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('confidence:low'), 'Should auto-derive confidence:low for prompt-capture');
    });

    it('should auto-derive medium confidence for session-capture', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        sourceType: 'session-capture',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('confidence:medium'), 'Should auto-derive confidence:medium for session-capture');
    });

    it('should use explicit confidence over auto-derived', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'project',
        sourceType: 'prompt-capture', // would derive 'low'
        confidence: 'verified', // explicit override
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('confidence:verified'), 'Should use explicit confidence:verified');
      assert.ok(!p.tags.includes('confidence:low'), 'Should not include auto-derived confidence');
    });

    it('should not add confidence tag when neither confidence nor sourceType provided', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'project',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      const confidenceTags = p.tags.filter((t: string) => t.startsWith('confidence:'));
      assert.strictEqual(confidenceTags.length, 0, 'Should not add confidence tag');
    });

    it('should not add source tag when sourceType not provided', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'project',
        confidence: 'high',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      const sourceTags = p.tags.filter((t: string) => t.startsWith('source:'));
      assert.strictEqual(sourceTags.length, 0, 'Should not add source tag');
    });

    it('should not duplicate source tag if already present', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        tags: ['source:session-capture'],
        sourceType: 'session-capture',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      const sourceTags = p.tags.filter((t: string) => t === 'source:session-capture');
      assert.strictEqual(sourceTags.length, 1, 'Should not duplicate source tag');
    });

    it('should not duplicate confidence tag if already present', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        tags: ['confidence:high'],
        confidence: 'high',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      const confidenceTags = p.tags.filter((t: string) => t === 'confidence:high');
      assert.strictEqual(confidenceTags.length, 1, 'Should not duplicate confidence tag');
    });

    it('should include lifecycle, source, and confidence tags together', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        tags: ['type:test'],
        sourceType: 'code-analysis',
        confidence: 'high',
      });

      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('lifecycle:session'), 'Should include lifecycle tag');
      assert.ok(p.tags.includes('source:code-analysis'), 'Should include source tag');
      assert.ok(p.tags.includes('confidence:high'), 'Should include confidence tag');
      assert.ok(p.tags.includes('type:test'), 'Should preserve existing tags');
    });
  });

  describe('verifyFact()', () => {
    it('should throw without a router', async () => {
      const service = new MemoryService(mcp, undefined, logger);

      await assert.rejects(
        () => service.verifyFact('group-1', 'uuid-abc'),
        { message: 'Verification requires a DAL router with Neo4j support' }
      );
    });

    it('should call expire on the repository via router', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        expire: mock.fn(async () => undefined),
        expireByFilter: mock.fn(async () => 0),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      await service.verifyFact('group-1', 'uuid-abc');

      assert.strictEqual(mockRepo.expire.mock.calls.length, 1);
      const [groupId, uuid] = mockRepo.expire.mock.calls[0].arguments;
      assert.strictEqual(groupId, 'group-1');
      assert.strictEqual(uuid, 'uuid-abc');
    });

    it('should throw when repository does not support expiration', async () => {
      const repoWithoutExpire = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'mcp' as const })),
        search: mock.fn(async () => ({ items: [], source: 'mcp' as const })),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => repoWithoutExpire),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      await assert.rejects(
        () => service.verifyFact('group-1', 'uuid-abc'),
        { message: 'Memory repository does not support expiration' }
      );
    });
  });

  describe('loadFactsByConfidence()', () => {
    it('should route to qualityRepo.findByMinConfidence when available', async () => {
      const mockItems = [createMockItem({ uuid: 'item-1' }), createMockItem({ uuid: 'item-2' })];
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findByMinConfidence: mock.fn(async () => ({ items: mockItems, source: 'neo4j' as const, hasMore: false })),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.loadFactsByConfidence(['group-1'], 'medium', 25);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(mockRepo.findByMinConfidence.mock.calls.length, 1);
      const [groupIds, minLevel, options] = mockRepo.findByMinConfidence.mock.calls[0].arguments;
      assert.deepStrictEqual(groupIds, ['group-1']);
      assert.strictEqual(minLevel, 'medium');
      assert.deepStrictEqual(options, { limit: 25 });
    });

    it('should fall back to loadFactsDateOrdered without router', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      callFn.mock.mockImplementation(async () => [{
        result: {
          facts: [createMockItem({ uuid: 'fallback-1' })],
        },
      }]);
      const service = new MemoryService(mcp, undefined, logger);

      const result = await service.loadFactsByConfidence(['group-1'], 'high');

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, 'fallback-1');
    });

    it('should fall back when repo does not have findByMinConfidence', async () => {
      // The fallback will go through loadFactsDateOrdered which tries router first
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({
          items: [createMockItem({ uuid: 'fallback-item' })],
          source: 'neo4j' as const,
          hasMore: false,
        })),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.loadFactsByConfidence(['group-1'], 'high');

      // Should fall back to loadFactsDateOrdered
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, 'fallback-item');
    });

    it('should fall back on findByMinConfidence error', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({
          items: [createMockItem({ uuid: 'error-fallback' })],
          source: 'neo4j' as const,
          hasMore: false,
        })),
        findByMinConfidence: mock.fn(async () => {
          throw new Error('Query failed');
        }),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.loadFactsByConfidence(['group-1'], 'high');

      // Should fall back to loadFactsDateOrdered
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, 'error-fallback');
    });

    it('should use default limit of 50', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findByMinConfidence: mock.fn(async () => ({ items: [], source: 'neo4j' as const, hasMore: false })),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      await service.loadFactsByConfidence(['group-1'], 'low');

      const [, , options] = mockRepo.findByMinConfidence.mock.calls[0].arguments;
      assert.deepStrictEqual(options, { limit: 50 });
    });
  });

  describe('findConflicts()', () => {
    it('should route to qualityRepo.findConflicts when available', async () => {
      const mockConflicts: IConflictGroup[] = [
        {
          topic: 'database',
          facts: [createMockItem({ fact: 'Uses PostgreSQL' }), createMockItem({ fact: 'Uses MySQL' })],
          detectedAt: new Date().toISOString(),
        },
      ];
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findConflicts: mock.fn(async () => mockConflicts),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.findConflicts(['group-1'], 'database');

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].topic, 'database');
      assert.strictEqual(result[0].facts.length, 2);
      assert.strictEqual(mockRepo.findConflicts.mock.calls.length, 1);
      const [groupIds, topic] = mockRepo.findConflicts.mock.calls[0].arguments;
      assert.deepStrictEqual(groupIds, ['group-1']);
      assert.strictEqual(topic, 'database');
    });

    it('should return empty array without router', async () => {
      const service = new MemoryService(mcp, undefined, logger);

      const result = await service.findConflicts(['group-1']);

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array when repo does not have findConflicts', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.findConflicts(['group-1']);

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array on findConflicts error', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findConflicts: mock.fn(async () => {
          throw new Error('Query failed');
        }),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.findConflicts(['group-1']);

      assert.deepStrictEqual(result, []);
    });

    it('should pass undefined topic when not provided', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findConflicts: mock.fn(async () => []),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      await service.findConflicts(['group-1', 'group-2']);

      const [groupIds, topic] = mockRepo.findConflicts.mock.calls[0].arguments;
      assert.deepStrictEqual(groupIds, ['group-1', 'group-2']);
      assert.strictEqual(topic, undefined);
    });
  });
});
