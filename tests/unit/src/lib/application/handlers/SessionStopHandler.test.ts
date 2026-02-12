/**
 * Tests for SessionStopHandler
 *
 * Tests session stop handling including:
 * - Capturing work from sessions
 * - Saving facts to memory
 * - Generating suggestions for GitHub sync
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SessionStopHandler } from '../../../../../../src/lib/application/handlers/SessionStopHandler';
import { SessionStopRequest } from '../../../../../../src/lib/application/mediator/requests';
import type {
  ILisaContext,
  IMemoryService,
  ISessionCaptureService,
  IEventEmitter,
  ITaskService,
  ITask,
  ICapturedWork,
  LisaEvent,
} from '../../../../../../src/lib/domain';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockContext(overrides: Partial<ILisaContext> = {}): ILisaContext {
  return {
    groupId: 'test-group',
    projectRoot: '/test/project',
    hierarchicalGroupIds: ['test-group'],
    projectName: 'test-project',
    projectAliases: ['test-project'],
    branch: 'main',
    userName: 'test-user',
    folderType: 'TypeScript',
    ...overrides,
  };
}

function createMockMemory(overrides: Partial<IMemoryService> = {}): IMemoryService {
  return {
    loadMemory: async () => ({ facts: [], nodes: [], tasks: [], initReview: null, timedOut: false }),
    loadFactsDateOrdered: async () => [],
    searchFacts: async () => [],
    saveMemory: async () => {},
    addFact: async () => {},
    addFactWithLifecycle: async () => {},
    expireFact: async () => {},
    cleanupExpired: async () => 0,
    ...overrides,
  };
}

function createMockSessionCapture(
  captured: ICapturedWork = { facts: [], complexity: 'low' }
): ISessionCaptureService {
  return {
    captureSessionWork: async () => captured,
  };
}

function createMockEvents(emitSpy?: (event: LisaEvent) => void): IEventEmitter {
  return {
    emit: async (event: LisaEvent) => {
      emitSpy?.(event);
    },
    on: () => {},
    off: () => {},
  };
}

function createMockTask(overrides: Partial<ITask> = {}): ITask {
  return {
    key: 'task-1',
    status: 'in-progress',
    title: 'Test Task',
    blocked: [],
    created_at: '2026-01-22T10:00:00Z',
    ...overrides,
  };
}

function createMockTaskService(tasks: ITask[] = []): ITaskService {
  return {
    getTasks: async () => tasks,
    getTasksSimple: async () => tasks,
    getTaskCounts: async () => ({
      ready: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      closed: 0,
      unknown: 0,
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

// ============================================================================
// Tests
// ============================================================================

describe('SessionStopHandler', () => {
  describe('handle()', () => {
    it('should pass transcript path to session capture service', async () => {
      let receivedTranscriptPath: string | undefined;
      let receivedSessionId: string | undefined;
      
      const sessionCapture: ISessionCaptureService = {
        captureSessionWork: async (sessionId, transcriptPath) => {
          receivedSessionId = sessionId;
          receivedTranscriptPath = transcriptPath;
          return { facts: ['Test fact'], complexity: 'low' };
        },
      };

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        sessionCapture,
        createMockEvents()
      );

      const request = new SessionStopRequest(
        'idle',
        '2026-01-22T12:00:00.000Z',
        'session-abc',
        '/explicit/path/to/transcript.jsonl'
      );

      await handler.handle(request);

      assert.strictEqual(receivedSessionId, 'session-abc');
      assert.strictEqual(receivedTranscriptPath, '/explicit/path/to/transcript.jsonl');
    });

    it('should pass undefined transcript path when not provided', async () => {
      let receivedTranscriptPath: string | undefined = 'not-called';
      
      const sessionCapture: ISessionCaptureService = {
        captureSessionWork: async (_sessionId, transcriptPath) => {
          receivedTranscriptPath = transcriptPath;
          return { facts: ['Test fact'], complexity: 'low' };
        },
      };

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        sessionCapture,
        createMockEvents()
      );

      const request = new SessionStopRequest(
        'idle',
        '2026-01-22T12:00:00.000Z',
        'session-xyz'
        // No transcript path
      );

      await handler.handle(request);

      assert.strictEqual(receivedTranscriptPath, undefined);
    });

    it('should handle session capture errors gracefully', async () => {
      const failingCapture: ISessionCaptureService = {
        captureSessionWork: async () => {
          throw new Error('Transcript not found');
        },
      };

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        failingCapture,
        createMockEvents()
      );

      const request = new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z');

      // Should throw - capture errors are not silently ignored
      await assert.rejects(
        async () => handler.handle(request),
        /Transcript not found/
      );
    });

    it('should handle memory save errors gracefully', async () => {
      const failingMemory = createMockMemory({
        addFactWithLifecycle: async () => {
          throw new Error('Memory unavailable');
        },
      });

      const handler = new SessionStopHandler(
        createMockContext(),
        failingMemory,
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents()
      );

      const request = new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z');

      // Memory save errors should propagate
      await assert.rejects(
        async () => handler.handle(request),
        /Memory unavailable/
      );
    });

    it('should capture facts and save to memory with session lifecycle', async () => {
      const savedFacts: string[] = [];
      const savedOptions: unknown[] = [];
      const context = createMockContext();
      const memory = createMockMemory({
        addFactWithLifecycle: async (fact, options) => {
          savedFacts.push(fact);
          savedOptions.push(options);
        },
      });
      const sessionCapture = createMockSessionCapture({
        facts: ['Implemented feature X', 'Fixed bug Y'],
        complexity: 'medium',
      });
      const events = createMockEvents();

      const handler = new SessionStopHandler(
        context,
        memory,
        sessionCapture,
        events
      );

      const request = new SessionStopRequest(
        'idle',
        '2026-01-22T12:00:00.000Z',
        'session-123'
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.factsCaptured, 2);
      assert.strictEqual(result.skipped, false);
      assert.ok(result.message.includes('2'));
      assert.deepStrictEqual(savedFacts, ['Implemented feature X', 'Fixed bug Y']);
      // Verify lifecycle options were passed
      for (const opts of savedOptions) {
        const o = opts as { lifecycle: string; tags: string[] };
        assert.strictEqual(o.lifecycle, 'session');
        assert.ok(o.tags.includes('type:session-capture'));
      }
    });

    it('should skip when no facts captured', async () => {
      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: [], complexity: 'low' }),
        createMockEvents()
      );

      const request = new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z');
      const result = await handler.handle(request);

      assert.strictEqual(result.factsCaptured, 0);
      assert.strictEqual(result.skipped, true);
      assert.ok(result.skipReason);
    });

    it('should emit memory:save event', async () => {
      let emittedEvent: LisaEvent | undefined;
      const events = createMockEvents((event) => {
        emittedEvent = event;
      });

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        events
      );

      await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

      assert.ok(emittedEvent);
      assert.strictEqual(emittedEvent?.type, 'memory:save');
    });
  });

  describe('suggestions', () => {
    it('should suggest GitHub export for unlinked incomplete tasks', async () => {
      const tasks = createMockTaskService([
        createMockTask({ key: '1', status: 'in-progress', title: 'Task 1' }),
        createMockTask({ key: '2', status: 'ready', title: 'Task 2' }),
      ]);

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents(),
        undefined,
        tasks
      );

      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      assert.ok(result.suggestions);
      const exportSuggestion = result.suggestions?.find(
        (s) => s.action === 'sync-github-export'
      );
      assert.ok(exportSuggestion);
      assert.strictEqual(exportSuggestion?.count, 2);
      assert.ok(exportSuggestion?.command.includes('--export'));
    });

    it('should suggest bidirectional sync for linked tasks', async () => {
      const tasks = createMockTaskService([
        createMockTask({
          key: '1',
          status: 'in-progress',
          title: 'Linked Task',
          externalLink: {
            source: 'github',
            id: '123',
            url: 'https://github.com/owner/repo/issues/123',
          },
        }),
      ]);

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents(),
        undefined,
        tasks
      );

      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      assert.ok(result.suggestions);
      const syncSuggestion = result.suggestions?.find(
        (s) => s.action === 'sync-github-bidirectional'
      );
      assert.ok(syncSuggestion);
      assert.strictEqual(syncSuggestion?.count, 1);
      assert.ok(syncSuggestion?.command === 'lisa github sync');
    });

    it('should not suggest export for completed tasks', async () => {
      const tasks = createMockTaskService([
        createMockTask({ key: '1', status: 'done', title: 'Completed Task' }),
        createMockTask({ key: '2', status: 'closed', title: 'Closed Task' }),
      ]);

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents(),
        undefined,
        tasks
      );

      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      const exportSuggestion = result.suggestions?.find(
        (s) => s.action === 'sync-github-export'
      );
      assert.ok(!exportSuggestion);
    });

    it('should not include suggestions when no tasks service', async () => {
      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents()
        // No tasks service
      );

      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      assert.ok(!result.suggestions || result.suggestions.length === 0);
    });

    it('should include suggestions even when session is skipped', async () => {
      const tasks = createMockTaskService([
        createMockTask({ key: '1', status: 'in-progress', title: 'Task 1' }),
      ]);

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: [], complexity: 'low' }), // No facts = skipped
        createMockEvents(),
        undefined,
        tasks
      );

      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      assert.strictEqual(result.skipped, true);
      assert.ok(result.suggestions);
      assert.ok(result.suggestions.length > 0);
    });

    it('should handle task service errors gracefully', async () => {
      const failingTaskService: ITaskService = {
        getTasks: async () => { throw new Error('DB error'); },
        getTasksSimple: async () => { throw new Error('DB error'); },
        getTaskCounts: async () => { throw new Error('DB error'); },
        createTask: async () => { throw new Error('DB error'); },
        updateTask: async () => { throw new Error('DB error'); },
      };

      const handler = new SessionStopHandler(
        createMockContext(),
        createMockMemory(),
        createMockSessionCapture({ facts: ['Fact 1'], complexity: 'low' }),
        createMockEvents(),
        undefined,
        failingTaskService
      );

      // Should not throw, just skip suggestions
      const result = await handler.handle(
        new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z')
      );

      assert.strictEqual(result.factsCaptured, 1);
      assert.ok(!result.suggestions || result.suggestions.length === 0);
    });
  });
});
