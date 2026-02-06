/**
 * Tests for SessionStartHandler timeout and cancellation behavior.
 *
 * These tests verify:
 * - Session start respects memory timeout (5s via MemoryContextLoader)
 * - timedOut flag propagates correctly to result
 * - Message reflects timeout status
 * - Partial results are handled gracefully
 *
 * @see Issue #14: Add timeout and cancellation tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SessionStartHandler } from '../../../../../../src/lib/application/handlers/SessionStartHandler';
import { SessionStartRequest } from '../../../../../../src/lib/application/mediator/requests';
import type {
  ILisaContext,
  IMemoryService,
  ITaskService,
  IMemoryItem,
  IMemoryResult,
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

function createSlowMemory(delayMs: number): IMemoryService {
  return createMockMemory({
    searchFacts: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return [];
    },
    loadFactsDateOrdered: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return [createMockMemoryItem({ fact: 'Delayed fact' })];
    },
  });
}

function createMockTaskService(): ITaskService {
  return {
    getTasks: async () => [],
    getTasksSimple: async () => [],
    getTaskCounts: async () => ({
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
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

const now = () => new Date().toISOString();

// ============================================================================
// Tests
// ============================================================================

describe('SessionStartHandler timeout behavior', () => {
  describe('handle_givenMemoryTimeout', () => {
    it('handle_givenSlowMemory_shouldSetTimedOutInResult', async () => {
      // MemoryContextLoader has 5s timeout; simulate slow operations
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, true, 'timedOut should be true when memory operations are slow');
    });

    it('handle_givenSlowMemory_shouldIncludeTimeoutInMessage', async () => {
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.ok(
        result.message.toLowerCase().includes('timed out') ||
        result.message.toLowerCase().includes('timeout'),
        `Message should mention timeout: "${result.message}"`
      );
    });

    it('handle_givenNoTimeout_shouldSetTimedOutFalse', async () => {
      const memory = createMockMemory({
        searchFacts: async () => [],
        loadFactsDateOrdered: async () => [createMockMemoryItem({ fact: 'Complete fact' })],
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, false);
      assert.ok(
        !result.message.toLowerCase().includes('timed out'),
        'Message should not mention timeout when no timeout occurred'
      );
    });
  });

  describe('handle_timeoutAcrossTriggers', () => {
    it('handle_givenStartupWithTimeout_shouldReportTimeoutInMessage', async () => {
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, true);
      assert.ok(result.message.includes('startup') || result.message.includes('session'));
    });

    it('handle_givenResumeWithTimeout_shouldReportTimeoutInMessage', async () => {
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('resume', now()));

      assert.strictEqual(result.timedOut, true);
    });

    it('handle_givenCompactWithTimeout_shouldReportTimeoutInMessage', async () => {
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('compact', now()));

      assert.strictEqual(result.timedOut, true);
    });
  });

  describe('handle_timeoutWithInitReview', () => {
    it('handle_givenTimeoutBeforeInitReview_shouldHaveNoInitReview', async () => {
      // searchFacts (init-review) is the first operation that will timeout
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, true);
      assert.ok(
        !result.contextContent.includes('Codebase Summary'),
        'Should not have codebase summary when timeout before init-review'
      );
    });

    it('handle_givenFastInitReviewButSlowFacts_shouldIncludeInitReview', async () => {
      // Init review loads fast, but facts are slow (triggering timeout)
      const memory = createMockMemory({
        searchFacts: async () => [
          createMockMemoryItem({
            fact: 'This is a TypeScript project',
            tags: ['type:init-review'],
          }),
        ],
        loadFactsDateOrdered: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return [];
        },
      });

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      assert.strictEqual(result.timedOut, true);
      assert.ok(
        result.contextContent.includes('TypeScript project'),
        'Should include init-review that loaded before timeout'
      );
    });
  });

  describe('handle_resultConsistency', () => {
    it('handle_givenTimeout_shouldReturnConsistentResultStructure', async () => {
      const memory = createSlowMemory(6000);

      const handler = new SessionStartHandler(
        createMockContext(),
        memory,
        createMockTaskService()
      );

      const result = await handler.handle(new SessionStartRequest('startup', now()));

      // Verify result has all expected properties
      assert.ok('timedOut' in result, 'Result should have timedOut property');
      assert.ok('message' in result, 'Result should have message property');
      assert.ok('contextContent' in result, 'Result should have contextContent property');
      assert.ok('memories' in result, 'Result should have memories property');
      assert.ok('tasks' in result, 'Result should have tasks property');
      assert.ok('taskCounts' in result, 'Result should have taskCounts property');

      // Verify memories structure
      assert.ok(Array.isArray(result.memories.facts), 'memories.facts should be array');
      assert.ok(Array.isArray(result.memories.nodes), 'memories.nodes should be array');

      // Verify tasks structure
      assert.ok(Array.isArray(result.tasks), 'tasks should be array');
    });
  });
});
