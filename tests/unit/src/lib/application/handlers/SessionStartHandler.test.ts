/**
 * Tests for SessionStartHandler
 *
 * Tests session start handling including:
 * - All trigger types (startup, resume, compact, clear)
 * - Memory loading with various result sizes
 * - Timeout behavior
 * - Output formatting
 * - Task processing and counting
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SessionStartHandler } from '../../../../../../src/lib/application/handlers/SessionStartHandler';
import { SessionStartRequest } from '../../../../../../src/lib/application/mediator/requests';
import type {
  ILisaContext,
  IMemoryService,
  ITaskService,
  IMcpClient,
  IMemoryItem,
  ITask,
  IMemoryResult,
  SessionTrigger,
} from '../../../../../../src/lib/domain';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockContext(overrides: Partial<ILisaContext> = {}): ILisaContext {
  return {
    groupId: 'test-group',
    projectRoot: '/test/project',
    hierarchicalGroupIds: ['test-group', 'parent-group'],
    projectName: 'test-project',
    projectAliases: ['test-project', 'tp'],
    branch: 'main',
    userName: 'test-user',
    folderType: 'TypeScript',
    ...overrides,
  };
}

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

function createMockTaskService(tasks: ITask[] = []): ITaskService {
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

function createMockMcp(): IMcpClient {
  return {
    initialize: async () => 'session-123',
    call: async <T>() => [{} as T, 'session-123'] as [T, string],
    ping: async () => true,
    getSessionId: () => 'session-123',
  };
}

// ============================================================================
// Tests
// ============================================================================

// Helper to create timestamp
const now = () => new Date().toISOString();

describe('SessionStartHandler', () => {
  describe('trigger handling', () => {
    it('handle_givenStartupTrigger_shouldReturnContextAndMessage', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const request = new SessionStartRequest('startup', now());
      const result = await handler.handle(request);

      assert.strictEqual(result.timedOut, false);
      assert.ok(result.message.includes('session start'));
      assert.ok(result.contextContent.includes('User:'));
    });

    it('handle_givenResumeTrigger_shouldReturnResumeMessage', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const request = new SessionStartRequest('resume', now());
      const result = await handler.handle(request);

      assert.ok(result.message.includes('resume'));
    });

    it('handle_givenCompactTrigger_shouldReturnCompactMessageAndContext', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const request = new SessionStartRequest('compact', now());
      const result = await handler.handle(request);

      assert.ok(result.message.includes('compact'));
      assert.ok(result.contextContent.includes('compacted'));
    });

    it('handle_givenClearTrigger_shouldReturnClearMessageAndContext', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const request = new SessionStartRequest('clear', now());
      const result = await handler.handle(request);

      assert.ok(result.message.includes('clear'));
      assert.ok(result.contextContent.includes('cleared'));
    });
  });

  describe('memory loading', () => {
    it('should load memories via memory service', async () => {
      let loadMemoryCalled = false;
      const memory = createMockMemory({
        loadMemory: async () => {
          loadMemoryCalled = true;
          return createMockMemoryResult({
            facts: [
              createMockMemoryItem({ fact: 'Fact 1' }),
              createMockMemoryItem({ fact: 'Fact 2' }),
            ],
          });
        },
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(loadMemoryCalled, true);
      assert.strictEqual(result.memories.facts.length, 2);
    });

    it('should include init review when present', async () => {
      const memory = createMockMemory({
        loadMemory: async () =>
          createMockMemoryResult({
            initReview: 'This is a TypeScript project with Node.js backend',
          }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.contextContent.includes('Codebase Summary'));
      assert.ok(result.contextContent.includes('TypeScript project'));
    });

    it('should handle timeout gracefully', async () => {
      const memory = createMockMemory({
        loadMemory: async () =>
          createMockMemoryResult({
            timedOut: true,
            facts: [createMockMemoryItem({ fact: 'Partial result' })],
          }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, true);
      assert.ok(result.message.includes('timed out'));
    });

    it('should handle empty memory result', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.memories.facts.length, 0);
      assert.strictEqual(result.memories.nodes.length, 0);
      assert.strictEqual(result.timedOut, false);
    });
  });

  describe('task processing', () => {
    it('should process tasks from memory result', async () => {
      const taskMemoryItem = createMockMemoryItem({
        uuid: 'task-uuid-123',
        name: 'Task Title',
        fact: 'Task Title',
        tags: ['type:task', 'task_id:task-1', 'status:in-progress'],
      });

      const memory = createMockMemory({
        loadMemory: async () =>
          createMockMemoryResult({
            tasks: [taskMemoryItem],
          }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.tasks.length > 0);
      assert.strictEqual(result.tasks[0].key, 'task-1');
      assert.strictEqual(result.tasks[0].status, 'in-progress');
    });

    it('should count tasks by status', async () => {
      const tasks = [
        createMockMemoryItem({
          tags: ['type:task', 'task_id:1', 'status:ready'],
        }),
        createMockMemoryItem({
          tags: ['type:task', 'task_id:2', 'status:ready'],
        }),
        createMockMemoryItem({
          tags: ['type:task', 'task_id:3', 'status:in-progress'],
        }),
        createMockMemoryItem({
          tags: ['type:task', 'task_id:4', 'status:done'],
        }),
      ];

      const memory = createMockMemory({
        loadMemory: async () => createMockMemoryResult({ tasks }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.taskCounts.ready, 2);
      assert.strictEqual(result.taskCounts['in-progress'], 1);
      assert.strictEqual(result.taskCounts.done, 1);
    });

    it('should deduplicate tasks by key', async () => {
      // Same task_id appears twice with different timestamps
      const tasks = [
        createMockMemoryItem({
          tags: ['type:task', 'task_id:dup-task', 'status:ready'],
          created_at: '2026-01-22T10:00:00Z',
        }),
        createMockMemoryItem({
          tags: ['type:task', 'task_id:dup-task', 'status:in-progress'],
          created_at: '2026-01-22T11:00:00Z', // Newer
        }),
      ];

      const memory = createMockMemory({
        loadMemory: async () => createMockMemoryResult({ tasks }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      // Should have only one task (deduplicated)
      const dupTasks = result.tasks.filter((t) => t.key === 'dup-task');
      assert.strictEqual(dupTasks.length, 1);
      // Should keep the newer one
      assert.strictEqual(dupTasks[0].status, 'in-progress');
    });
  });

  describe('output formatting', () => {
    it('should include user and project info in context', async () => {
      const context = createMockContext({
        userName: 'developer',
        projectName: 'my-app',
        branch: 'feature-branch',
      });

      const handler = new SessionStartHandler(
        context,
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.contextContent.includes('developer'));
      assert.ok(result.contextContent.includes('my-app'));
      assert.ok(result.contextContent.includes('feature-branch'));
    });

    it('should format recent memories within 24 hours', async () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
      const memory = createMockMemory({
        loadMemory: async () =>
          createMockMemoryResult({
            facts: [
              createMockMemoryItem({
                fact: 'Recent work on feature X',
                created_at: recentTime,
              }),
            ],
          }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.contextContent.includes('Recent memories'));
    });

    it('should show task summary in context', async () => {
      const tasks = [
        createMockMemoryItem({
          name: 'Active Task',
          tags: ['type:task', 'task_id:1', 'status:in-progress'],
        }),
        createMockMemoryItem({
          name: 'Ready Task',
          tags: ['type:task', 'task_id:2', 'status:ready'],
        }),
      ];

      const memory = createMockMemory({
        loadMemory: async () => createMockMemoryResult({ tasks }),
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.contextContent.includes('Tasks:'));
      assert.ok(result.contextContent.includes('in-progress'));
      assert.ok(result.contextContent.includes('Active'));
    });

    it('should show message when no tasks found', async () => {
      const handler = new SessionStartHandler(
        createMockContext(),
        createMockMemory(),
        createMockTaskService(),
        createMockMcp()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(result.contextContent.includes('Tasks: none'));
    });
  });

  describe('error handling', () => {
    it('handle_givenMemoryServiceError_shouldPropagateError', async () => {
      const memory = createMockMemory({
        loadMemory: async () => {
          throw new Error('Memory service unavailable');
        },
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService(),
        createMockMcp()
      );

      // Handler propagates memory errors to caller
      await assert.rejects(
        handler.handle(new SessionStartRequest('startup', now())),
        /Memory service unavailable/
      );
    });
  });
});
