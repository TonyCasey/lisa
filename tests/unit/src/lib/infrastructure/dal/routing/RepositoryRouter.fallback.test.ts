/**
 * RepositoryRouter Fallback Tests
 *
 * Tests the routing fallback behavior when preferred backends are unavailable.
 * Verifies correct backend selection and logging during fallback scenarios.
 */

import { describe, it, beforeEach, mock, Mock } from 'node:test';
import assert from 'node:assert';
import { RepositoryRouter } from '../../../../../../../src/lib/infrastructure/dal/routing/RepositoryRouter';
import type {
  IMemoryRepository,
  IReadOnlyMemoryRepository,
  ITaskRepository,
  IReadOnlyTaskRepository,
  IMemoryQueryResult,
  ITaskQueryResult,
  IRoutingRule,
  BackendSource,
} from '../../../../../../../src/lib/domain/interfaces/dal';
import type { IMemoryItem } from '../../../../../../../src/lib/domain/interfaces/types/IMemoryResult';
import type { ITask, ITaskCounts } from '../../../../../../../src/lib/domain/interfaces/types/ITask';
import type { ILogger } from '../../../../../../../src/lib/domain/interfaces';

/**
 * Create a mock memory repository.
 */
function createMockMemoryRepository(
  backend: BackendSource,
  overrides?: Partial<IMemoryRepository>
): IMemoryRepository {
  const defaultResult: IMemoryQueryResult = {
    items: [{ uuid: '1', name: 'test', fact: 'test fact', created_at: new Date().toISOString() }],
    source: backend,
    total: 1,
  };

  return {
    findByGroupIds: mock.fn(async () => defaultResult),
    search: mock.fn(async () => defaultResult),
    findByTags: mock.fn(async () => defaultResult),
    save: mock.fn(async () => defaultResult.items[0] as IMemoryItem),
    saveBatch: mock.fn(async () => defaultResult.items),
    supportsSemanticSearch: () => backend !== 'neo4j',
    supportsDateOrdering: () => true,
    supportsWrite: () => backend !== 'neo4j',
    ...overrides,
  };
}

/**
 * Create a mock read-only memory repository.
 */
function createMockReadOnlyMemoryRepository(
  backend: BackendSource,
  overrides?: Partial<IReadOnlyMemoryRepository>
): IReadOnlyMemoryRepository {
  const defaultResult: IMemoryQueryResult = {
    items: [{ uuid: '1', name: 'test', fact: 'test fact', created_at: new Date().toISOString() }],
    source: backend,
    total: 1,
  };

  return {
    findByGroupIds: mock.fn(async () => defaultResult),
    search: mock.fn(async () => defaultResult),
    findByTags: mock.fn(async () => defaultResult),
    supportsSemanticSearch: () => backend !== 'neo4j',
    supportsDateOrdering: () => true,
    supportsWrite: () => false,
    ...overrides,
  };
}

/**
 * Create a mock task repository.
 */
function createMockTaskRepository(
  backend: BackendSource,
  overrides?: Partial<ITaskRepository>
): ITaskRepository {
  const defaultTask: ITask = {
    key: 'test-1',
    title: 'Test task',
    status: 'ready',
    blocked: [],
    created_at: new Date().toISOString(),
  };

  const defaultResult: ITaskQueryResult = {
    items: [defaultTask],
    source: backend,
    total: 1,
  };

  const defaultCounts: ITaskCounts = {
    ready: 1,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
  };

  return {
    findByGroupIds: mock.fn(async () => defaultResult),
    findByKey: mock.fn(async () => defaultTask),
    findByStatus: mock.fn(async () => defaultResult),
    getCounts: mock.fn(async () => defaultCounts),
    create: mock.fn(async () => defaultTask),
    update: mock.fn(async () => defaultTask),
    delete: mock.fn(async () => {}),
    supportsWrite: () => backend !== 'neo4j',
    supportsAggregation: () => true,
    ...overrides,
  };
}

/**
 * Create a mock logger that captures log calls.
 */
function createMockLogger(): ILogger & { debugCalls: unknown[][]; warnCalls: unknown[][] } {
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];

  const logger: ILogger & { debugCalls: unknown[][]; warnCalls: unknown[][] } = {
    debugCalls,
    warnCalls,
    trace: () => {},
    debug: (...args: unknown[]) => { debugCalls.push(args); },
    info: () => {},
    warn: (...args: unknown[]) => { warnCalls.push(args); },
    error: () => {},
    fatal: () => {},
    child: () => createMockLogger(),
    isLevelEnabled: () => true,
  };

  return logger;
}

describe('RepositoryRouter Fallback Tests', () => {
  describe('Preferred Backend Available', () => {
    it('should use preferred backend when available for list operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const neo4jRepo = createMockReadOnlyMemoryRepository('neo4j');
      const mcpRepo = createMockMemoryRepository('mcp');

      router.registerMemoryRepository('neo4j', neo4jRepo);
      router.registerMemoryRepository('mcp', mcpRepo);

      // list operation prefers neo4j
      const repo = router.getMemoryRepository('list');

      // Should get neo4j since it's preferred for list
      assert.strictEqual(repo, neo4jRepo);

      // Logger should have logged preferred backend selection
      const preferredLog = logger.debugCalls.find(
        call => call[0] === 'Resolved backend (preferred)' && 
                (call[1] as { backend: string })?.backend === 'neo4j'
      );
      assert.ok(preferredLog, 'Should log preferred backend selection');
    });

    it('should use preferred backend when available for search operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const mcpRepo = createMockMemoryRepository('mcp');
      const zepRepo = createMockMemoryRepository('zep');

      router.registerMemoryRepository('mcp', mcpRepo);
      router.registerMemoryRepository('zep', zepRepo);

      // search operation prefers mcp
      const repo = router.getMemoryRepository('search');

      assert.strictEqual(repo, mcpRepo);
    });

    it('should use preferred backend when available for write operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const mcpRepo = createMockMemoryRepository('mcp');
      const zepRepo = createMockMemoryRepository('zep');

      router.registerMemoryRepository('mcp', mcpRepo);
      router.registerMemoryRepository('zep', zepRepo);

      // write operation prefers mcp
      const repo = router.getMemoryRepository('write');

      assert.strictEqual(repo, mcpRepo);
    });

    it('should use preferred backend when available for aggregate operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const neo4jRepo = createMockReadOnlyMemoryRepository('neo4j');
      const mcpRepo = createMockMemoryRepository('mcp');

      router.registerMemoryRepository('neo4j', neo4jRepo);
      router.registerMemoryRepository('mcp', mcpRepo);

      // aggregate operation prefers neo4j
      const repo = router.getMemoryRepository('aggregate');

      assert.strictEqual(repo, neo4jRepo);
    });
  });

  describe('Fallback When Preferred Unavailable', () => {
    it('should fallback to mcp when neo4j unavailable for list operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register mcp, not neo4j
      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      // list operation prefers neo4j, but should fallback to mcp
      const repo = router.getMemoryRepository('list');

      assert.strictEqual(repo, mcpRepo);

      // Logger should have logged fallback selection
      const fallbackLog = logger.debugCalls.find(
        call => call[0] === 'Resolved backend (fallback)' && 
                (call[1] as { backend: string })?.backend === 'mcp'
      );
      assert.ok(fallbackLog, 'Should log fallback backend selection');
    });

    it('should fallback to zep when mcp unavailable for search operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register zep, not mcp
      const zepRepo = createMockMemoryRepository('zep');
      router.registerMemoryRepository('zep', zepRepo);

      // search operation prefers mcp, but should fallback to zep
      const repo = router.getMemoryRepository('search');

      assert.strictEqual(repo, zepRepo);
    });

    it('should fallback to zep when mcp unavailable for write operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register zep, not mcp
      const zepRepo = createMockMemoryRepository('zep');
      router.registerMemoryRepository('zep', zepRepo);

      // write operation prefers mcp, but should fallback to zep
      const repo = router.getMemoryRepository('write');

      assert.strictEqual(repo, zepRepo);
    });

    it('should fallback to mcp when neo4j unavailable for aggregate operation', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register mcp, not neo4j
      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      // aggregate operation prefers neo4j, but should fallback to mcp
      const repo = router.getMemoryRepository('aggregate');

      assert.strictEqual(repo, mcpRepo);
    });
  });

  describe('Any Available Backend When No Rule Match', () => {
    it('should use any available backend when preferred and fallback both unavailable', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register zep, but list operation wants neo4j->mcp
      const zepRepo = createMockMemoryRepository('zep');
      router.registerMemoryRepository('zep', zepRepo);

      // list operation: preferred=neo4j, fallback=mcp, but only zep available
      const repo = router.getMemoryRepository('list');

      assert.strictEqual(repo, zepRepo);

      // Logger should have logged "any available" selection
      const anyAvailableLog = logger.debugCalls.find(
        call => call[0] === 'Resolved backend (any available)' && 
                (call[1] as { backend: string })?.backend === 'zep'
      );
      assert.ok(anyAvailableLog, 'Should log any available backend selection');
    });

    it('should use any available backend when no rule exists for operation', () => {
      const logger = createMockLogger();
      // Create router with empty rules
      const router = new RepositoryRouter({ backends: [], rules: [] }, logger);

      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      // No rule for 'list', should use any available
      const repo = router.getMemoryRepository('list');

      assert.strictEqual(repo, mcpRepo);

      // Logger should have logged "no rule" selection
      const noRuleLog = logger.debugCalls.find(
        call => call[0] === 'Resolved backend (no rule)'
      );
      assert.ok(noRuleLog, 'Should log no rule backend selection');
    });
  });

  describe('Error When No Backends Available', () => {
    it('should throw error when no memory repositories registered', () => {
      const router = new RepositoryRouter();

      assert.throws(
        () => router.getMemoryRepository('list'),
        (err: Error) => {
          // The error comes from resolveBackend first, then wraps in getMemoryRepository
          return err.message.includes('No backend available') ||
                 err.message.includes('No memory repository available');
        }
      );
    });

    it('should throw error when no task repositories registered', () => {
      const router = new RepositoryRouter();

      assert.throws(
        () => router.getTaskRepository('list'),
        (err: Error) => {
          return err.message.includes('No backend available') ||
                 err.message.includes('No task repository available');
        }
      );
    });

    it('should throw with empty rules and no repositories', () => {
      const router = new RepositoryRouter({ backends: [], rules: [] });

      assert.throws(
        () => router.getMemoryRepository('list'),
        (err: Error) => {
          return err.message.includes('No repositories available');
        }
      );
    });
  });

  describe('Task Repository Routing', () => {
    it('should route task operations with fallback', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register mcp task repo, not neo4j
      const mcpTaskRepo = createMockTaskRepository('mcp');
      router.registerTaskRepository('mcp', mcpTaskRepo);

      // list operation prefers neo4j, but should fallback to mcp
      const repo = router.getTaskRepository('list');

      assert.strictEqual(repo, mcpTaskRepo);
    });

    it('should use preferred backend for task write operations', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const mcpTaskRepo = createMockTaskRepository('mcp');
      const zepTaskRepo = createMockTaskRepository('zep');

      router.registerTaskRepository('mcp', mcpTaskRepo);
      router.registerTaskRepository('zep', zepTaskRepo);

      // write operation prefers mcp
      const repo = router.getTaskRepository('write');

      assert.strictEqual(repo, mcpTaskRepo);
    });
  });

  describe('Custom Routing Rules', () => {
    it('should respect custom routing rules', () => {
      const customRules: IRoutingRule[] = [
        { operation: 'list', preferred: 'zep', fallback: 'mcp' },
        { operation: 'search', preferred: 'neo4j', fallback: 'mcp' },
      ];

      const router = new RepositoryRouter({ backends: [], rules: customRules });

      const zepRepo = createMockMemoryRepository('zep');
      const mcpRepo = createMockMemoryRepository('mcp');

      router.registerMemoryRepository('zep', zepRepo);
      router.registerMemoryRepository('mcp', mcpRepo);

      // list operation should prefer zep with custom rules
      const repo = router.getMemoryRepository('list');

      assert.strictEqual(repo, zepRepo);
    });

    it('should allow runtime rule updates', () => {
      const router = new RepositoryRouter();

      const neo4jRepo = createMockReadOnlyMemoryRepository('neo4j');
      const mcpRepo = createMockMemoryRepository('mcp');

      router.registerMemoryRepository('neo4j', neo4jRepo);
      router.registerMemoryRepository('mcp', mcpRepo);

      // Default: list prefers neo4j
      let repo = router.getMemoryRepository('list');
      assert.strictEqual(repo, neo4jRepo);

      // Update rule: list now prefers mcp
      router.setRoutingRule('list', 'mcp', 'neo4j');

      repo = router.getMemoryRepository('list');
      assert.strictEqual(repo, mcpRepo);
    });
  });

  describe('Backend Availability Checks', () => {
    it('should report available backends correctly', () => {
      const router = new RepositoryRouter();

      assert.strictEqual(router.isBackendAvailable('mcp'), false);
      assert.strictEqual(router.isBackendAvailable('neo4j'), false);
      assert.strictEqual(router.isBackendAvailable('zep'), false);

      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      assert.strictEqual(router.isBackendAvailable('mcp'), true);
      assert.strictEqual(router.isBackendAvailable('neo4j'), false);
    });

    it('should return all available backends', () => {
      const router = new RepositoryRouter();

      const mcpRepo = createMockMemoryRepository('mcp');
      const neo4jRepo = createMockReadOnlyMemoryRepository('neo4j');

      router.registerMemoryRepository('mcp', mcpRepo);
      router.registerMemoryRepository('neo4j', neo4jRepo);

      const backends = router.getAvailableBackends();

      assert.ok(backends.includes('mcp'));
      assert.ok(backends.includes('neo4j'));
      assert.strictEqual(backends.length, 2);
    });

    it('should return null for unavailable backend by name', () => {
      const router = new RepositoryRouter();

      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      assert.strictEqual(router.getMemoryRepositoryByBackend('mcp'), mcpRepo);
      assert.strictEqual(router.getMemoryRepositoryByBackend('neo4j'), null);
      assert.strictEqual(router.getTaskRepositoryByBackend('mcp'), null);
    });
  });

  describe('Logging During Fallback', () => {
    it('should log initialization with backends and rules count', () => {
      const logger = createMockLogger();
      new RepositoryRouter({ backends: ['mcp', 'neo4j'] }, logger);

      const initLog = logger.debugCalls.find(
        call => call[0] === 'Router initialized'
      );
      assert.ok(initLog, 'Should log initialization');
      
      const logData = initLog[1] as { backends: string[]; rulesCount: number };
      assert.ok(Array.isArray(logData.backends));
      assert.strictEqual(typeof logData.rulesCount, 'number');
    });

    it('should log repository registration', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      const registerLog = logger.debugCalls.find(
        call => call[0] === 'Registered memory repository' && 
                (call[1] as { backend: string })?.backend === 'mcp'
      );
      assert.ok(registerLog, 'Should log memory repository registration');
    });

    it('should log task repository registration', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      const mcpTaskRepo = createMockTaskRepository('mcp');
      router.registerTaskRepository('mcp', mcpTaskRepo);

      const registerLog = logger.debugCalls.find(
        call => call[0] === 'Registered task repository' && 
                (call[1] as { backend: string })?.backend === 'mcp'
      );
      assert.ok(registerLog, 'Should log task repository registration');
    });

    it('should log fallback with preferred backend info', () => {
      const logger = createMockLogger();
      const router = new RepositoryRouter(undefined, logger);

      // Only register mcp, not neo4j
      const mcpRepo = createMockMemoryRepository('mcp');
      router.registerMemoryRepository('mcp', mcpRepo);

      // list operation prefers neo4j, but should fallback to mcp
      router.getMemoryRepository('list');

      const fallbackLog = logger.debugCalls.find(
        call => call[0] === 'Resolved backend (fallback)'
      );
      assert.ok(fallbackLog, 'Should log fallback');
      
      const logData = fallbackLog[1] as { preferred: string; backend: string };
      assert.strictEqual(logData.preferred, 'neo4j');
      assert.strictEqual(logData.backend, 'mcp');
    });
  });

  describe('Routing Rules Retrieval', () => {
    it('should return current routing rules', () => {
      const router = new RepositoryRouter();

      const rules = router.getRoutingRules();

      // Should have default rules
      assert.ok(rules.length > 0);

      const listRule = rules.find(r => r.operation === 'list');
      assert.ok(listRule);
      assert.strictEqual(listRule.preferred, 'neo4j');
      assert.strictEqual(listRule.fallback, 'mcp');
    });

    it('should return custom rules when provided', () => {
      const customRules: IRoutingRule[] = [
        { operation: 'list', preferred: 'zep' },
      ];

      const router = new RepositoryRouter({ backends: [], rules: customRules });

      const rules = router.getRoutingRules();

      assert.strictEqual(rules.length, 1);
      assert.strictEqual(rules[0].operation, 'list');
      assert.strictEqual(rules[0].preferred, 'zep');
      assert.strictEqual(rules[0].fallback, undefined);
    });
  });
});
