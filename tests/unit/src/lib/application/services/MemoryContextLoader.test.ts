/**
 * Tests for MemoryContextLoader
 *
 * Tests memory loading via git-mem:
 * - Init-review loading via searchFacts
 * - Fact loading via loadFactsDateOrdered
 * - Task conversion to IMemoryItem format
 * - Date options passing
 * - Graceful failure handling for each sub-operation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryContextLoader } from '../../../../../../src/lib/application/services/MemoryContextLoader';
import type {
  IMemoryService,
  ITaskService,
  IMemoryItem,
  ITask,
  ILogger,
  IMemoryDateOptions,
} from '../../../../../../src/lib/domain';

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

function createMockMemory(overrides: Partial<IMemoryService> = {}): IMemoryService {
  return {
    loadMemory: async () => ({
      facts: [],
      nodes: [],
      tasks: [],
      initReview: null,
      timedOut: false,
    }),
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
    createTask: async (input) => ({
      key: 'new-task',
      status: input.status || 'ready',
      title: input.title,
      blocked: [...(input.blocked || [])],
    }),
    updateTask: async (_taskId, updates) => ({
      key: 'task-1',
      status: updates.status || 'ready',
      title: updates.title || 'Task',
      blocked: [],
    }),
  };
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

describe('MemoryContextLoader', () => {
  describe('fact loading', () => {
    it('should load facts via loadFactsDateOrdered', async () => {
      let loadFactsCalled = false;

      const memory = createMockMemory({
        loadFactsDateOrdered: async () => {
          loadFactsCalled = true;
          return [
            createMockMemoryItem({ fact: 'Fact 1' }),
            createMockMemoryItem({ fact: 'Fact 2' }),
          ];
        },
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(loadFactsCalled, true, 'loadFactsDateOrdered should have been called');
      assert.strictEqual(result.facts.length, 2);
      assert.strictEqual(result.facts[0].fact, 'Fact 1');
      assert.strictEqual(result.facts[1].fact, 'Fact 2');
    });

    it('should handle empty facts result', async () => {
      const loader = new MemoryContextLoader(
        createMockMemory(),
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.timedOut, false);
    });
  });

  describe('init-review loading', () => {
    it('should load init-review via searchFacts with init-review query', async () => {
      let receivedQuery: string | undefined;
      let receivedLimit: number | undefined;

      const memory = createMockMemory({
        searchFacts: async (query, limit) => {
          receivedQuery = query;
          receivedLimit = limit;
          return [
            createMockMemoryItem({
              fact: 'This is a TypeScript project with Node.js backend',
              tags: ['type:init-review'],
            }),
          ];
        },
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(result.initReview, null);
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

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(tasks),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(result.tasks.length, 3);
      assert.strictEqual(result.tasks[0].uuid, 't1');
      assert.strictEqual(result.tasks[1].uuid, 't2');
      assert.strictEqual(result.tasks[2].uuid, 't3');
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
      taskService.getTasksSimple = async () => {
        getTasksCalled = true;
        return origGetTasks();
      };

      const loader = new MemoryContextLoader(
        memory,
        taskService,
        createMockLogger()
      );

      const result = await loader.loadMemory();

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
      taskService.getTasksSimple = async () => {
        getTasksCalled = true;
        return origGetTasks();
      };

      const loader = new MemoryContextLoader(
        memory,
        taskService,
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const loader = new MemoryContextLoader(
        memory,
        failingTaskService,
        createMockLogger()
      );

      const result = await loader.loadMemory();

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

      const loader = new MemoryContextLoader(
        memory,
        failingTaskService,
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.nodes.length, 0);
      assert.strictEqual(result.tasks.length, 0);
      assert.strictEqual(result.initReview, null);
      assert.strictEqual(result.timedOut, false);
    });
  });

  describe('date options', () => {
    it('should pass date options to loadFactsDateOrdered', async () => {
      let receivedOptions: IMemoryDateOptions | undefined;

      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async (_limit, options) => {
          receivedOptions = options;
          return [createMockMemoryItem()];
        },
      });

      const dateOptions: IMemoryDateOptions = {
        since: new Date('2026-01-01'),
        until: new Date('2026-01-31'),
      };

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService(),
        createMockLogger()
      );

      await loader.loadMemory(dateOptions);

      assert.ok(receivedOptions, 'date options should have been passed');
      assert.deepStrictEqual(receivedOptions?.since, new Date('2026-01-01'));
      assert.deepStrictEqual(receivedOptions?.until, new Date('2026-01-31'));
    });
  });

  describe('result structure', () => {
    it('should return correct IMemoryLoadResult shape', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [
          createMockMemoryItem({ tags: ['type:init-review'], fact: 'Init review content' }),
        ],
        loadFactsDateOrdered: async () => [createMockMemoryItem()],
      });

      const loader = new MemoryContextLoader(
        memory,
        createMockTaskService([createMockTask()]),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.ok(Array.isArray(result.facts), 'facts should be array');
      assert.ok(Array.isArray(result.nodes), 'nodes should be array');
      assert.ok(Array.isArray(result.tasks), 'tasks should be array');
      assert.strictEqual(typeof result.timedOut, 'boolean', 'timedOut should be boolean');
      assert.strictEqual(result.initReview, 'Init review content');
    });

    it('should always return empty nodes array (no MCP node fallback)', async () => {
      const loader = new MemoryContextLoader(
        createMockMemory(),
        createMockTaskService(),
        createMockLogger()
      );

      const result = await loader.loadMemory();

      assert.strictEqual(result.nodes.length, 0, 'nodes should always be empty with git-mem');
    });
  });
});
