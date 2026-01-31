/**
 * Tests for MemoryContextLoader
 *
 * Tests memory loading strategy routing:
 * - MCP fallback when no router or Neo4j unavailable
 * - DAL path with Neo4j for date-ordered facts
 * - Init-review loading via searchFacts
 * - Node fallback when no facts found
 * - Task conversion to IMemoryItem format
 * - Graceful failure handling for each sub-operation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryContextLoader } from '../../../../../../src/lib/application/services/MemoryContextLoader';
import type {
  IMemoryService,
  ITaskService,
  IMcpClient,
  IMemoryItem,
  ITask,
  IMemoryResult,
  ILogger,
  IMemoryDateOptions,
} from '../../../../../../src/lib/domain';
import type { IRepositoryRouter } from '../../../../../../src/lib/domain/interfaces/dal';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockMemoryItem(overrides: Partial<IMemoryItem> = {}): IMemoryItem {
  return {
    uuid: `item-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Memory',
    fact: 'Test fact content',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockMemoryResult(overrides: Partial<IMemoryResult> = {}): IMemoryResult {
  return {
    facts: [],
    nodes: [],
    tasks: [],
    initReview: null,
    timedOut: false,
    ...overrides,
  };
}

function createMockMemory(overrides: Partial<IMemoryService> = {}): IMemoryService {
  return {
    loadMemory: async () => createMockMemoryResult(),
    loadFactsDateOrdered: async () => [],
    searchFacts: async () => [],
    saveMemory: async () => {},
    addFact: async () => {},
    ...overrides,
  };
}

function createMockTask(overrides: Partial<ITask> = {}): ITask {
  return {
    key: `task-${Math.random().toString(36).slice(2, 8)}`,
    status: 'ready',
    title: 'Test Task',
    blocked: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTaskService(tasks: readonly ITask[] = []): ITaskService {
  return {
    getTasks: async () => tasks,
    getTasksSimple: async () => tasks,
    getTaskCounts: async () => ({
      ready: tasks.filter((t) => t.status === 'ready').length,
      'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      done: tasks.filter((t) => t.status === 'done').length,
      closed: tasks.filter((t) => t.status === 'closed').length,
      unknown: tasks.filter((t) => t.status === 'unknown').length,
    }),
    createTask: async (_groupId, input) => ({
      key: 'new-task',
      status: input.status || 'ready',
      title: input.title,
      blocked: [...(input.blocked || [])],
    }),
    updateTask: async (_groupId, _taskId, updates) => ({
      key: 'task-1',
      status: updates.status || 'ready',
      title: updates.title || 'Task',
      blocked: [],
    }),
  };
}

function createMockMcp(overrides: Partial<IMcpClient> = {}): IMcpClient {
  return {
    initialize: async () => 'session-123',
    call: async <T>() => [{} as T, 'session-123'] as [T, string],
    ping: async () => true,
    getSessionId: () => 'session-123',
    ...overrides,
  };
}

function createMockRouter(
  neo4jAvailable: boolean,
  overrides: Partial<IRepositoryRouter> = {}
): IRepositoryRouter {
  return {
    isBackendAvailable: (backend: string) => {
      if (backend === 'neo4j') return neo4jAvailable;
      return false;
    },
    getMemoryRepository: () => { throw new Error('Not implemented in mock'); },
    getTaskRepository: () => { throw new Error('Not implemented in mock'); },
    getMemoryRepositoryByBackend: () => null,
    getTaskRepositoryByBackend: () => null,
    getAvailableBackends: () => neo4jAvailable ? ['neo4j', 'mcp'] : ['mcp'],
    getRoutingRules: () => [],
    setRoutingRule: () => {},
    ...overrides,
  } as IRepositoryRouter;
}

function createMockLogger(): ILogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => createMockLogger(),
    isLevelEnabled: () => true,
  };
}

// ============================================================================
// Tests
// ============================================================================

const defaultGroupIds = ['test-group', 'parent-group'] as const;
const defaultAliases = ['test-project', 'tp'] as const;
const defaultBranch = 'main';

describe('MemoryContextLoader', () => {
  describe('MCP fallback path', () => {
    it('should fall back to MCP when no router provided', async () => {
      let loadMemoryCalled = false;
      let receivedTimeout: number | undefined;

      const memory = createMockMemory({
        loadMemory: async (_groupIds, _aliases, _branch, timeoutMs) => {
          loadMemoryCalled = true;
          receivedTimeout = timeoutMs;
          return createMockMemoryResult({
            facts: [createMockMemoryItem({ fact: 'MCP fact' })],
          });
        },
      });

      // No router provided
      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(loadMemoryCalled, true, 'loadMemory should have been called');
      assert.strictEqual(receivedTimeout, 5000, 'should pass 5000ms timeout');
      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0].fact, 'MCP fact');
    });

    it('should fall back to MCP when router says neo4j not available', async () => {
      let loadMemoryCalled = false;

      const memory = createMockMemory({
        loadMemory: async () => {
          loadMemoryCalled = true;
          return createMockMemoryResult({
            facts: [createMockMemoryItem({ fact: 'Fallback fact' })],
          });
        },
      });

      const router = createMockRouter(false); // neo4j NOT available

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(loadMemoryCalled, true, 'loadMemory should have been called as fallback');
      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0].fact, 'Fallback fact');
    });
  });

  describe('DAL path (neo4j available)', () => {
    it('should use DAL path when router reports neo4j available', async () => {
      let searchFactsCalled = false;
      let loadFactsCalled = false;
      let getTasksCalled = false;
      let loadMemoryCalled = false;

      const facts = [
        createMockMemoryItem({ fact: 'DAL fact 1' }),
        createMockMemoryItem({ fact: 'DAL fact 2' }),
      ];

      const tasks = [
        createMockTask({ key: 'task-1', title: 'Task One', status: 'ready' }),
      ];

      const memory = createMockMemory({
        loadMemory: async () => {
          loadMemoryCalled = true;
          return createMockMemoryResult();
        },
        searchFacts: async () => {
          searchFactsCalled = true;
          return [];
        },
        loadFactsDateOrdered: async () => {
          loadFactsCalled = true;
          return facts;
        },
      });

      const taskService = createMockTaskService(tasks);
      const origGetTasksSimple = taskService.getTasksSimple;
      taskService.getTasksSimple = async (groupIds) => {
        getTasksCalled = true;
        return origGetTasksSimple(groupIds);
      };

      const router = createMockRouter(true); // neo4j available

      const loader = new MemoryContextLoader(
        memory,
        taskService,
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(loadMemoryCalled, false, 'loadMemory (MCP path) should NOT be called');
      assert.strictEqual(searchFactsCalled, true, 'searchFacts should have been called for init-review');
      assert.strictEqual(loadFactsCalled, true, 'loadFactsDateOrdered should have been called');
      assert.strictEqual(getTasksCalled, true, 'getTasksSimple should have been called');
      assert.strictEqual(result.facts.length, 2);
      assert.strictEqual(result.tasks.length, 1);
    });

    it('should load init-review via searchFacts with init-review query', async () => {
      let receivedQuery: string | undefined;
      let receivedLimit: number | undefined;

      const memory = createMockMemory({
        searchFacts: async (_groupIds, query, limit) => {
          receivedQuery = query;
          receivedLimit = limit;
          return [
            createMockMemoryItem({
              fact: 'This is a TypeScript project with Node.js backend',
              tags: ['type:init-review'],
            }),
          ];
        },
        loadFactsDateOrdered: async () => [createMockMemoryItem()], // return facts so nodes path is skipped
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(receivedQuery, 'init-review', 'should search for init-review');
      assert.strictEqual(receivedLimit, 1, 'should request only 1 result');
      assert.strictEqual(
        result.initReview,
        'This is a TypeScript project with Node.js backend',
        'should extract init-review from fact field'
      );
    });

    it('should extract init-review from name field when fact is missing', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [
          createMockMemoryItem({
            fact: undefined,
            name: 'Init review from name field',
            tags: ['type:init-review'],
          }),
        ],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.initReview, 'Init review from name field');
    });

    it('should set initReview to null when no init-review fact found', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [
          // Return a fact without the init-review tag
          createMockMemoryItem({ tags: ['type:regular'] }),
        ],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.initReview, null);
    });

    it('should fall back to nodes via MCP when no facts found', async () => {
      let mcpCallMethod: string | undefined;
      let mcpCallParams: Record<string, unknown> | undefined;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [], // No facts returned
      });

      const mcp = createMockMcp({
        call: async <T>(method: string, params?: Record<string, unknown>) => {
          mcpCallMethod = method;
          mcpCallParams = params;
          const response = {
            result: {
              nodes: [
                createMockMemoryItem({ uuid: 'node-1', name: 'Node One' }),
                createMockMemoryItem({ uuid: 'node-2', name: 'Node Two' }),
              ],
            },
          };
          return [response as T, 'session-123'] as [T, string];
        },
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        mcp,
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.facts.length, 0, 'no facts expected');
      assert.ok(result.nodes.length > 0, 'should have loaded nodes as fallback');
      assert.strictEqual(mcpCallMethod, 'search_nodes', 'should call search_nodes on MCP');
      assert.ok(mcpCallParams, 'MCP call should have params');
      assert.ok(
        Array.isArray(mcpCallParams?.group_ids),
        'params should include group_ids'
      );
    });

    it('should deduplicate nodes across project aliases', async () => {
      const sharedNode = createMockMemoryItem({ uuid: 'shared-uuid', name: 'Shared Node' });

      const mcp = createMockMcp({
        call: async <T>() => {
          const response = {
            result: {
              nodes: [sharedNode],
            },
          };
          return [response as T, 'session-123'] as [T, string];
        },
      });

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [], // No facts -> triggers node fallback
      });

      const router = createMockRouter(true);

      // Two aliases means two MCP calls, both returning the same node
      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        mcp,
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        ['alias-a', 'alias-b'],
        defaultBranch
      );

      // Should deduplicate by uuid
      assert.strictEqual(result.nodes.length, 1, 'duplicates should be removed');
      assert.strictEqual(result.nodes[0].uuid, 'shared-uuid');
    });

    it('should not load nodes when facts are found', async () => {
      let mcpCalled = false;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [
          createMockMemoryItem({ fact: 'Has facts' }),
        ],
      });

      const mcp = createMockMcp({
        call: async <T>() => {
          mcpCalled = true;
          return [{} as T, 'session-123'] as [T, string];
        },
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        mcp,
        router,
        createMockLogger()
      );

      await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(mcpCalled, false, 'should not call MCP for nodes when facts exist');
    });
  });

  describe('task conversion', () => {
    it('should convert tasks to IMemoryItem format with correct tags', async () => {
      const tasks = [
        createMockTask({
          key: 'PROJ-42',
          title: 'Implement feature X',
          status: 'in-progress',
          created_at: '2026-01-20T10:00:00Z',
        }),
      ];

      const router = createMockRouter(true);

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.tasks.length, 1);
      const taskItem = result.tasks[0];
      assert.strictEqual(taskItem.uuid, 'PROJ-42');
      assert.strictEqual(taskItem.name, 'Implement feature X');
      assert.strictEqual(taskItem.fact, 'Implement feature X');
      assert.strictEqual(taskItem.created_at, '2026-01-20T10:00:00Z');
      assert.ok(taskItem.tags, 'should have tags');

      const tags = taskItem.tags as readonly string[];
      assert.ok(tags.includes('type:task'), 'should include type:task tag');
      assert.ok(tags.includes('task_id:PROJ-42'), 'should include task_id tag');
      assert.ok(tags.includes('status:in-progress'), 'should include status tag');
    });

    it('should include blocked_by tags for blocked tasks', async () => {
      const tasks = [
        createMockTask({
          key: 'PROJ-99',
          title: 'Blocked task',
          status: 'blocked',
          blocked: ['PROJ-50', 'PROJ-51'],
        }),
      ];

      const router = createMockRouter(true);

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      const tags = result.tasks[0].tags as readonly string[];
      assert.ok(tags.includes('blocked_by:PROJ-50'), 'should include first blocked_by');
      assert.ok(tags.includes('blocked_by:PROJ-51'), 'should include second blocked_by');
    });

    it('should handle tasks with no blocked array', async () => {
      const tasks = [
        createMockTask({
          key: 'PROJ-10',
          title: 'Normal task',
          status: 'ready',
          blocked: [],
        }),
      ];

      const router = createMockRouter(true);

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      const tags = result.tasks[0].tags as readonly string[];
      const blockedTags = tags.filter((t) => t.startsWith('blocked_by:'));
      assert.strictEqual(blockedTags.length, 0, 'should have no blocked_by tags');
    });

    it('should convert multiple tasks', async () => {
      const tasks = [
        createMockTask({ key: 't1', title: 'Task 1', status: 'ready' }),
        createMockTask({ key: 't2', title: 'Task 2', status: 'in-progress' }),
        createMockTask({ key: 't3', title: 'Task 3', status: 'done' }),
      ];

      const router = createMockRouter(true);

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.tasks.length, 3);
      assert.strictEqual(result.tasks[0].uuid, 't1');
      assert.strictEqual(result.tasks[1].uuid, 't2');
      assert.strictEqual(result.tasks[2].uuid, 't3');
    });
  });

  describe('group ID merging', () => {
    it('should merge hierarchicalGroupIds and projectAliases for DAL queries', async () => {
      let receivedGroupIds: readonly string[] = [];

      const memory = createMockMemory({
        searchFacts: async (groupIds) => {
          receivedGroupIds = groupIds;
          return [];
        },
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      await loader.loadMemory(
        ['group-a', 'group-b'],
        ['alias-x', 'alias-y'],
        defaultBranch
      );

      // Should combine and deduplicate
      assert.ok(receivedGroupIds.includes('group-a'));
      assert.ok(receivedGroupIds.includes('group-b'));
      assert.ok(receivedGroupIds.includes('alias-x'));
      assert.ok(receivedGroupIds.includes('alias-y'));
    });

    it('should deduplicate overlapping group IDs and aliases', async () => {
      let receivedGroupIds: readonly string[] = [];

      const memory = createMockMemory({
        searchFacts: async (groupIds) => {
          receivedGroupIds = groupIds;
          return [];
        },
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      // 'shared-id' appears in both lists
      await loader.loadMemory(
        ['shared-id', 'group-only'],
        ['shared-id', 'alias-only'],
        defaultBranch
      );

      // Should be deduplicated via Set
      const uniqueIds = [...new Set(receivedGroupIds)];
      assert.strictEqual(receivedGroupIds.length, uniqueIds.length, 'IDs should be deduplicated');
      assert.strictEqual(receivedGroupIds.length, 3, 'should have 3 unique IDs');
    });
  });

  describe('graceful failure handling', () => {
    it('should handle searchFacts failure gracefully and continue', async () => {
      let loadFactsCalled = false;
      let getTasksCalled = false;

      const memory = createMockMemory({
        searchFacts: async () => {
          throw new Error('Search failed');
        },
        loadFactsDateOrdered: async () => {
          loadFactsCalled = true;
          return [createMockMemoryItem({ fact: 'Fact despite search failure' })];
        },
      });

      const taskService = createMockTaskService([
        createMockTask({ key: 't1', title: 'Task 1', status: 'ready' }),
      ]);
      const origGetTasks = taskService.getTasksSimple;
      taskService.getTasksSimple = async (groupIds) => {
        getTasksCalled = true;
        return origGetTasks(groupIds);
      };

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        taskService,
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.initReview, null, 'initReview should be null after search failure');
      assert.strictEqual(loadFactsCalled, true, 'should still load facts');
      assert.strictEqual(result.facts.length, 1, 'facts should be loaded despite search failure');
      assert.strictEqual(getTasksCalled, true, 'should still load tasks');
      assert.strictEqual(result.tasks.length, 1, 'tasks should be loaded despite search failure');
    });

    it('should handle loadFactsDateOrdered failure gracefully and continue', async () => {
      let getTasksCalled = false;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => {
          throw new Error('Fact loading failed');
        },
      });

      const taskService = createMockTaskService([
        createMockTask({ key: 't1', title: 'Task 1', status: 'ready' }),
      ]);
      const origGetTasks = taskService.getTasksSimple;
      taskService.getTasksSimple = async (groupIds) => {
        getTasksCalled = true;
        return origGetTasks(groupIds);
      };

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        taskService,
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.facts.length, 0, 'no facts after failure');
      assert.strictEqual(getTasksCalled, true, 'should still load tasks after fact failure');
      assert.strictEqual(result.tasks.length, 1, 'tasks should be loaded despite fact failure');
    });

    it('should handle getTasksSimple failure gracefully and continue', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [
          createMockMemoryItem({ fact: 'Fact loaded successfully' }),
        ],
      });

      const failingTaskService: ITaskService = {
        getTasks: async () => { throw new Error('Task DB error'); },
        getTasksSimple: async () => { throw new Error('Task DB error'); },
        getTaskCounts: async () => { throw new Error('Task DB error'); },
        createTask: async () => { throw new Error('Task DB error'); },
        updateTask: async () => { throw new Error('Task DB error'); },
      };

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        failingTaskService,
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.facts.length, 1, 'facts should still be loaded');
      assert.strictEqual(result.tasks.length, 0, 'tasks should be empty after failure');
      assert.strictEqual(result.timedOut, false, 'should not report timeout');
    });

    it('should continue with empty results when all sub-operations fail', async () => {
      const memory = createMockMemory({
        searchFacts: async () => { throw new Error('Search failed'); },
        loadFactsDateOrdered: async () => { throw new Error('Facts failed'); },
      });

      const failingTaskService: ITaskService = {
        getTasks: async () => { throw new Error('Task error'); },
        getTasksSimple: async () => { throw new Error('Task error'); },
        getTaskCounts: async () => { throw new Error('Task error'); },
        createTask: async () => { throw new Error('Task error'); },
        updateTask: async () => { throw new Error('Task error'); },
      };

      // MCP call for nodes may also fail since facts are empty (triggering node fallback)
      const mcp = createMockMcp({
        call: async () => {
          throw new Error('MCP node search failed');
        },
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        failingTaskService,
        mcp,
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.nodes.length, 0);
      assert.strictEqual(result.tasks.length, 0);
      assert.strictEqual(result.initReview, null);
      assert.strictEqual(result.timedOut, false);
    });
  });

  describe('branch tagging', () => {
    it('should include repo and branch tags when building node search params', async () => {
      let receivedParams: Record<string, unknown> | undefined;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [], // No facts -> triggers node fallback
      });

      const mcp = createMockMcp({
        call: async <T>(_method: string, params?: Record<string, unknown>) => {
          receivedParams = params;
          const response = { result: { nodes: [] } };
          return [response as T, 'session-123'] as [T, string];
        },
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        mcp,
        router,
        createMockLogger()
      );

      await loader.loadMemory(
        defaultGroupIds,
        ['my-repo'],
        'feature-branch'
      );

      assert.ok(receivedParams, 'MCP should have been called with params');
      const tags = receivedParams?.tags as string[];
      assert.ok(tags.includes('repo:my-repo'), 'should include repo tag');
      assert.ok(tags.includes('branch:feature-branch'), 'should include branch tag');
    });

    it('should not include branch tag when branch is null', async () => {
      let receivedParams: Record<string, unknown> | undefined;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [],
      });

      const mcp = createMockMcp({
        call: async <T>(_method: string, params?: Record<string, unknown>) => {
          receivedParams = params;
          const response = { result: { nodes: [] } };
          return [response as T, 'session-123'] as [T, string];
        },
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        mcp,
        router,
        createMockLogger()
      );

      await loader.loadMemory(
        defaultGroupIds,
        ['my-repo'],
        null // null branch
      );

      assert.ok(receivedParams, 'MCP should have been called');
      const tags = receivedParams?.tags as string[];
      assert.ok(tags.includes('repo:my-repo'), 'should include repo tag');
      const branchTags = tags.filter((t) => t.startsWith('branch:'));
      assert.strictEqual(branchTags.length, 0, 'should not include branch tag when null');
    });
  });

  describe('date options', () => {
    it('should pass date options to loadFactsDateOrdered', async () => {
      let receivedOptions: IMemoryDateOptions | undefined;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async (_groupIds, _limit, options) => {
          receivedOptions = options;
          return [createMockMemoryItem()];
        },
      });

      const router = createMockRouter(true);
      const dateOptions: IMemoryDateOptions = {
        since: new Date('2026-01-01'),
        until: new Date('2026-01-31'),
      };

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp(),
        router,
        createMockLogger()
      );

      await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch,
        dateOptions
      );

      assert.ok(receivedOptions, 'date options should have been passed');
      assert.deepStrictEqual(receivedOptions?.since, new Date('2026-01-01'));
      assert.deepStrictEqual(receivedOptions?.until, new Date('2026-01-31'));
    });
  });

  describe('result structure', () => {
    it('should return correct IMemoryLoadResult shape on MCP path', async () => {
      const memory = createMockMemory({
        loadMemory: async () => createMockMemoryResult({
          facts: [createMockMemoryItem()],
          nodes: [createMockMemoryItem()],
          tasks: [createMockMemoryItem()],
          initReview: 'review text',
          timedOut: false,
        }),
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.ok('facts' in result, 'result should have facts');
      assert.ok('nodes' in result, 'result should have nodes');
      assert.ok('tasks' in result, 'result should have tasks');
      assert.ok('initReview' in result, 'result should have initReview');
      assert.ok('timedOut' in result, 'result should have timedOut');
    });

    it('should return correct IMemoryLoadResult shape on DAL path', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [
          createMockMemoryItem({ tags: ['type:init-review'], fact: 'Init review content' }),
        ],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const router = createMockRouter(true);

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService([createMockTask()]),
        createMockMcp(),
        router,
        createMockLogger()
      );

      const result = await loader.loadMemory(
        defaultGroupIds,
        defaultAliases,
        defaultBranch
      );

      assert.ok(Array.isArray(result.facts), 'facts should be array');
      assert.ok(Array.isArray(result.nodes), 'nodes should be array');
      assert.ok(Array.isArray(result.tasks), 'tasks should be array');
      assert.strictEqual(typeof result.timedOut, 'boolean', 'timedOut should be boolean');
      assert.strictEqual(result.initReview, 'Init review content');
    });
  });
});
