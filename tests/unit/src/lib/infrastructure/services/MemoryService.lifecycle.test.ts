/**
 * Tests for MemoryService lifecycle methods.
 *
 * Tests addFactWithLifecycle, expireFact, and cleanupExpired.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { MemoryService } from '../../../../../../src/lib/infrastructure/services/MemoryService';
import type { IMcpClient, ILogger } from '../../../../../../src/lib/domain';
import type { IRepositoryRouter } from '../../../../../../src/lib/domain/interfaces/dal';

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
    expireByFilter: mock.fn(async () => 3),
    save: mock.fn(async () => ({ name: 'test', fact: 'test', created_at: new Date().toISOString() })),
  };

  return {
    getMemoryRepository: mock.fn(() => mockRepo),
    getTaskRepository: mock.fn(() => ({})),
    getPullRequestRepository: mock.fn(() => ({})),
    ...overrides,
  } as unknown as IRepositoryRouter;
}

describe('MemoryService - lifecycle', () => {
  let mcp: IMcpClient;
  let logger: ILogger;

  beforeEach(() => {
    mcp = createMockMcpClient();
    logger = createMockLogger();
  });

  describe('addFactWithLifecycle()', () => {
    it('should add lifecycle tag to existing tags', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'session',
        tags: ['type:test'],
      });

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('lifecycle:session'));
      assert.ok(p.tags.includes('type:test'));
    });

    it('should default to project lifecycle when not specified', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {});

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('lifecycle:project'));
    });

    it('should not duplicate lifecycle tag if already present', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'ephemeral',
        tags: ['lifecycle:ephemeral', 'type:prompt'],
      });

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      const lifecycleTags = p.tags.filter((t: string) => t === 'lifecycle:ephemeral');
      assert.strictEqual(lifecycleTags.length, 1, 'Should not duplicate lifecycle tag');
    });

    it('should work with empty tags', async () => {
      const callFn = mcp.call as ReturnType<typeof mock.fn>;
      const service = new MemoryService(mcp, undefined, logger);

      await service.addFactWithLifecycle('group-1', 'Test fact', {
        lifecycle: 'permanent',
      });

      assert.strictEqual(callFn.mock.calls.length, 1);
      const [, params] = callFn.mock.calls[0].arguments;
      const p = params as { tags: string[] };
      assert.ok(p.tags.includes('lifecycle:permanent'));
    });
  });

  describe('expireFact()', () => {
    it('should throw without a router', async () => {
      const service = new MemoryService(mcp, undefined, logger);

      await assert.rejects(
        () => service.expireFact('group-1', 'uuid-abc'),
        { message: 'Expiration requires a DAL router with Neo4j support' }
      );
    });

    it('should call expire on the repository via router', async () => {
      const router = createMockRouter();
      const service = new MemoryService(mcp, router, logger);

      await service.expireFact('group-1', 'uuid-abc');

      const getRepoFn = router.getMemoryRepository as ReturnType<typeof mock.fn>;
      assert.strictEqual(getRepoFn.mock.calls.length, 1);
      assert.strictEqual(getRepoFn.mock.calls[0].arguments[0], 'list');
    });

    it('should throw when repository does not support expiration', async () => {
      const repoWithoutExpire = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'mcp' as const })),
        search: mock.fn(async () => ({ items: [], source: 'mcp' as const })),
        findByTags: mock.fn(async () => ({ items: [], source: 'mcp' as const })),
        supportsSemanticSearch: () => true,
        supportsDateOrdering: () => true,
        supportsWrite: () => true,
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => repoWithoutExpire),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      await assert.rejects(
        () => service.expireFact('group-1', 'uuid-abc'),
        { message: 'Memory repository does not support expiration' }
      );
    });
  });

  describe('cleanupExpired()', () => {
    it('should throw without a router', async () => {
      const service = new MemoryService(mcp, undefined, logger);

      await assert.rejects(
        () => service.cleanupExpired('group-1'),
        { message: 'Cleanup requires a DAL router with Neo4j support' }
      );
    });

    it('should call expireByFilter for session and ephemeral tiers', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        search: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findByTags: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        supportsSemanticSearch: () => false,
        supportsDateOrdering: () => true,
        supportsWrite: () => false,
        expire: mock.fn(async () => undefined),
        expireByFilter: mock.fn(async () => 2),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.cleanupExpired('group-1');

      // Should call expireByFilter twice (once for session, once for ephemeral)
      assert.strictEqual(mockRepo.expireByFilter.mock.calls.length, 2);

      const [, filter1] = mockRepo.expireByFilter.mock.calls[0].arguments;
      assert.strictEqual(filter1.lifecycle, 'session');
      assert.ok(filter1.olderThan instanceof Date);

      const [, filter2] = mockRepo.expireByFilter.mock.calls[1].arguments;
      assert.strictEqual(filter2.lifecycle, 'ephemeral');
      assert.ok(filter2.olderThan instanceof Date);

      // Total expired should be sum of both calls (2 + 2 = 4)
      assert.strictEqual(result, 4);
    });

    it('should return 0 when no facts expired', async () => {
      const mockRepo = {
        findByGroupIds: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        search: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        findByTags: mock.fn(async () => ({ items: [], source: 'neo4j' as const })),
        supportsSemanticSearch: () => false,
        supportsDateOrdering: () => true,
        supportsWrite: () => false,
        expire: mock.fn(async () => undefined),
        expireByFilter: mock.fn(async () => 0),
      };
      const router = createMockRouter({
        getMemoryRepository: mock.fn(() => mockRepo),
      } as unknown as Partial<IRepositoryRouter>);
      const service = new MemoryService(mcp, router, logger);

      const result = await service.cleanupExpired('group-1');
      assert.strictEqual(result, 0);
    });
  });
});
