/**
 * Tests for SessionStopHandler quality tags (#179).
 *
 * Verifies that the handler adds quality tags (source, confidence, taskType)
 * when saving facts to memory.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SessionStopHandler } from '../../../../../../src/lib/application/handlers/SessionStopHandler';
import { SessionStopRequest } from '../../../../../../src/lib/application/mediator/requests';
import type {
  ILisaContext,
  IMemoryService,
  IMemorySaveOptions,
  ISessionCaptureService,
  IEventEmitter,
  ICapturedWork,
  LisaEvent,
} from '../../../../../../src/lib/domain';

/** Captured options from addFactWithLifecycle calls. */
type SavedOptions = IMemorySaveOptions;

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

function createMockSessionCapture(captured: ICapturedWork): ISessionCaptureService {
  return {
    captureSessionWork: async () => captured,
  };
}

function createMockEvents(): IEventEmitter {
  return {
    emit: async (_event: LisaEvent) => {},
    on: () => {},
    off: () => {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SessionStopHandler — quality tags (#179)', () => {
  it('should include source:session-capture and confidence:medium tags', async () => {
    const savedOptions: SavedOptions[] = [];
    const memory = createMockMemory({
      addFactWithLifecycle: async (_fact, options) => {
        savedOptions.push(options);
      },
    });

    const handler = new SessionStopHandler(
      createMockContext(),
      memory,
      createMockSessionCapture({ facts: ['Some fact'], complexity: 'low' }),
      createMockEvents()
    );

    await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

    assert.strictEqual(savedOptions.length, 1);
    assert.ok(savedOptions[0].tags.includes('type:session-capture'), 'Should include type:session-capture');
    assert.ok(savedOptions[0].tags.includes('source:session-capture'), 'Should include source:session-capture');
    assert.ok(savedOptions[0].tags.includes('confidence:medium'), 'Should include confidence:medium');
  });

  it('should include taskType tag when work has detectedTaskType', async () => {
    const savedOptions: SavedOptions[] = [];
    const memory = createMockMemory({
      addFactWithLifecycle: async (_fact, options) => {
        savedOptions.push(options);
      },
    });

    const captured: ICapturedWork = {
      facts: ['Debugging fact'],
      complexity: 'medium',
      work: {
        messageCount: 10,
        userPrompts: 3,
        assistantResponses: 3,
        toolCalls: 4,
        filesCreated: [],
        filesModified: ['src/fix.ts'],
        duration: 0,
        summary: 'Fixed a bug',
        detectedTaskType: 'debugging',
      },
    };

    const handler = new SessionStopHandler(
      createMockContext(),
      memory,
      createMockSessionCapture(captured),
      createMockEvents()
    );

    await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

    assert.strictEqual(savedOptions.length, 1);
    assert.ok(savedOptions[0].tags.includes('taskType:debugging'), 'Should include taskType:debugging');
  });

  it('should not include taskType tag when work has no detectedTaskType', async () => {
    const savedOptions: SavedOptions[] = [];
    const memory = createMockMemory({
      addFactWithLifecycle: async (_fact, options) => {
        savedOptions.push(options);
      },
    });

    const captured: ICapturedWork = {
      facts: ['General fact'],
      complexity: 'low',
      work: {
        messageCount: 5,
        userPrompts: 2,
        assistantResponses: 2,
        toolCalls: 1,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: 'Some work',
        // No detectedTaskType
      },
    };

    const handler = new SessionStopHandler(
      createMockContext(),
      memory,
      createMockSessionCapture(captured),
      createMockEvents()
    );

    await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

    assert.strictEqual(savedOptions.length, 1);
    const taskTypeTags = savedOptions[0].tags.filter(t => t.startsWith('taskType:'));
    assert.strictEqual(taskTypeTags.length, 0, 'Should not have any taskType tag');
  });

  it('should not include taskType tag when work field is undefined', async () => {
    const savedOptions: SavedOptions[] = [];
    const memory = createMockMemory({
      addFactWithLifecycle: async (_fact, options) => {
        savedOptions.push(options);
      },
    });

    // No work field at all
    const captured: ICapturedWork = {
      facts: ['A fact'],
      complexity: 'low',
    };

    const handler = new SessionStopHandler(
      createMockContext(),
      memory,
      createMockSessionCapture(captured),
      createMockEvents()
    );

    await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

    assert.strictEqual(savedOptions.length, 1);
    const taskTypeTags = savedOptions[0].tags.filter(t => t.startsWith('taskType:'));
    assert.strictEqual(taskTypeTags.length, 0, 'Should not have any taskType tag');
    // Should still have the base tags
    assert.ok(savedOptions[0].tags.includes('source:session-capture'));
    assert.ok(savedOptions[0].tags.includes('confidence:medium'));
  });

  it('should apply same tags to all facts in a session', async () => {
    const savedOptions: SavedOptions[] = [];
    const memory = createMockMemory({
      addFactWithLifecycle: async (_fact, options) => {
        savedOptions.push(options);
      },
    });

    const captured: ICapturedWork = {
      facts: ['Fact 1', 'Fact 2', 'Fact 3'],
      complexity: 'medium',
      work: {
        messageCount: 20,
        userPrompts: 5,
        assistantResponses: 5,
        toolCalls: 10,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: 'Work done',
        detectedTaskType: 'execution',
      },
    };

    const handler = new SessionStopHandler(
      createMockContext(),
      memory,
      createMockSessionCapture(captured),
      createMockEvents()
    );

    await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

    assert.strictEqual(savedOptions.length, 3);
    for (const opts of savedOptions) {
      assert.ok(opts.tags.includes('type:session-capture'));
      assert.ok(opts.tags.includes('source:session-capture'));
      assert.ok(opts.tags.includes('confidence:medium'));
      assert.ok(opts.tags.includes('taskType:execution'));
    }
  });

  it('should include taskType for each valid task type value', async () => {
    const taskTypes = ['planning', 'execution', 'exploration', 'debugging'] as const;

    for (const taskType of taskTypes) {
      const savedTags: string[][] = [];
      const memory = createMockMemory({
        addFactWithLifecycle: async (_fact, options) => {
          savedTags.push(options.tags ?? []);
        },
      });

      const captured: ICapturedWork = {
        facts: ['A fact'],
        complexity: 'low',
        work: {
          messageCount: 5,
          userPrompts: 2,
          assistantResponses: 2,
          toolCalls: 1,
          filesCreated: [],
          filesModified: [],
          duration: 0,
          summary: 'Work',
          detectedTaskType: taskType,
        },
      };

      const handler = new SessionStopHandler(
        createMockContext(),
        memory,
        createMockSessionCapture(captured),
        createMockEvents()
      );

      await handler.handle(new SessionStopRequest('idle', '2026-01-22T12:00:00.000Z'));

      assert.strictEqual(savedTags.length, 1);
      assert.ok(
        savedTags[0].includes(`taskType:${taskType}`),
        `Should include taskType:${taskType}`
      );
    }
  });
});
