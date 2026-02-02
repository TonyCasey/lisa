/**
 * Tests for PromptSubmitHandler
 *
 * Tests prompt submit handling including:
 * - Basic prompt processing
 * - Memory storage of prompts
 * - Plan mode recursion
 * - Truncation of long prompts
 * - Error handling (silent failures)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PromptSubmitHandler } from '../../../../../../src/lib/application/handlers/PromptSubmitHandler';
import { PromptSubmitRequest } from '../../../../../../src/lib/application/mediator/requests';
import type {
  ILisaContext,
  ILisaServices,
  IMemoryService,
  IRecursionService,
  IRecursionResult,
  ILogger,
  ITaskTypeDetector,
  ITaskTypeResult,
  IProactiveDetector,
  IProactiveDetection,
  PermissionMode,
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

function createMockMemoryService(overrides: Partial<IMemoryService> = {}): IMemoryService {
  return {
    addFact: async () => {},
    addFactWithLifecycle: async () => {},
    expireFact: async () => {},
    cleanupExpired: async () => 0,
    search: async () => [],
    listRecent: async () => [],
    loadMemory: async () => ({
      facts: [],
      tasks: [],
      initReview: undefined,
      totalFacts: 0,
      totalTasks: 0,
    }),
    ...overrides,
  } as IMemoryService;
}

function createMockRecursionResult(overrides: Partial<IRecursionResult> = {}): IRecursionResult {
  return {
    hasContext: false,
    decisions: [],
    learnings: [],
    relatedTasks: [],
    summary: '',
    ...overrides,
  };
}

function createMockRecursionService(overrides: Partial<IRecursionService> = {}): IRecursionService {
  return {
    shouldRun: () => false,
    run: async () => createMockRecursionResult(),
    ...overrides,
  };
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
  };
  return logger;
}

function createMockServices(overrides: Partial<ILisaServices> = {}): ILisaServices {
  return {
    context: createMockContext(),
    memory: createMockMemoryService(),
    recursion: createMockRecursionService(),
    logger: createMockLogger(),
    ...overrides,
  } as ILisaServices;
}

function createMockTaskTypeDetector(
  result?: Partial<ITaskTypeResult>
): ITaskTypeDetector {
  const defaultResult: ITaskTypeResult = {
    taskType: 'execution',
    confidence: 0.5,
    signals: ['implement'],
    ...result,
  };
  return {
    detect: () => defaultResult,
  };
}

function createMockProactiveDetector(
  result?: Partial<IProactiveDetection>
): IProactiveDetector {
  const defaultResult: IProactiveDetection = {
    shouldSuggest: false,
    ...result,
  };
  return {
    detect: () => defaultResult,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PromptSubmitHandler', () => {
  let context: ILisaContext;
  let memory: IMemoryService;
  let recursion: IRecursionService;
  let logger: ILogger;

  beforeEach(() => {
    context = createMockContext();
    memory = createMockMemoryService();
    recursion = createMockRecursionService();
    logger = createMockLogger();
  });

  describe('constructor', () => {
    it('should accept ILisaServices (legacy)', () => {
      const services = createMockServices();
      const handler = new PromptSubmitHandler(services);
      assert.ok(handler, 'Handler should be created with services');
    });

    it('should accept individual service injection', () => {
      const handler = new PromptSubmitHandler(context, memory, recursion, logger);
      assert.ok(handler, 'Handler should be created with individual services');
    });

    it('should work without optional services', () => {
      const handler = new PromptSubmitHandler(context, memory);
      assert.ok(handler, 'Handler should be created without recursion/logger');
    });
  });

  describe('basic prompt handling', () => {
    it('should return prompt content unchanged', async () => {
      const handler = new PromptSubmitHandler(context, memory);
      const request = new PromptSubmitRequest(
        'Test prompt content',
        '2024-01-15T10:00:00.000Z'
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.content, 'Test prompt content');
      assert.strictEqual(result.blocked, false);
    });

    it('should not block prompts by default', async () => {
      const handler = new PromptSubmitHandler(context, memory);
      const request = new PromptSubmitRequest(
        'Any prompt',
        '2024-01-15T10:00:00.000Z'
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.blocked, false);
      assert.strictEqual(result.blockReason, undefined);
    });

    it('should set planModeRecursion to false when not in plan mode', async () => {
      const handler = new PromptSubmitHandler(context, memory, recursion);
      const request = new PromptSubmitRequest(
        'Test prompt',
        '2024-01-15T10:00:00.000Z',
        'session-123',
        'default' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.planModeRecursion, false);
      assert.strictEqual(result.additionalContext, undefined);
    });
  });

  describe('memory storage', () => {
    it('should add prompt to memory with ephemeral lifecycle', async () => {
      let addedFact: { groupId: string; fact: string; options: unknown } | undefined;
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (groupId, fact, options) => {
          addedFact = { groupId, fact, options };
        },
      });

      const handler = new PromptSubmitHandler(context, mockMemory);
      const request = new PromptSubmitRequest(
        'Test prompt content',
        '2024-01-15T10:00:00.000Z'
      );

      await handler.handle(request);

      assert.ok(addedFact, 'Fact should be added');
      assert.strictEqual(addedFact.groupId, 'test-group');
      assert.ok(addedFact.fact.includes('User prompt at 2024-01-15T10:00:00.000Z'));
      assert.ok(addedFact.fact.includes('Test prompt content'));
      const opts = addedFact.options as { lifecycle: string; tags: string[] };
      assert.strictEqual(opts.lifecycle, 'ephemeral');
      assert.deepStrictEqual(opts.tags, ['type:prompt']);
    });

    it('should truncate long prompts to 200 characters', async () => {
      let addedFact: string | undefined;
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, fact) => {
          addedFact = fact;
        },
      });

      const longPrompt = 'x'.repeat(300);
      const handler = new PromptSubmitHandler(context, mockMemory);
      const request = new PromptSubmitRequest(
        longPrompt,
        '2024-01-15T10:00:00.000Z'
      );

      await handler.handle(request);

      assert.ok(addedFact, 'Fact should be added');
      // Truncated content should be 200 chars + '...'
      assert.ok(addedFact.includes('x'.repeat(200) + '...'));
      assert.ok(!addedFact.includes('x'.repeat(201)));
    });

    it('should not truncate short prompts', async () => {
      let addedFact: string | undefined;
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, fact) => {
          addedFact = fact;
        },
      });

      const shortPrompt = 'Short prompt';
      const handler = new PromptSubmitHandler(context, mockMemory);
      const request = new PromptSubmitRequest(
        shortPrompt,
        '2024-01-15T10:00:00.000Z'
      );

      await handler.handle(request);

      assert.ok(addedFact, 'Fact should be added');
      assert.ok(addedFact.includes('Short prompt'));
      assert.ok(!addedFact.includes('...'));
    });

    it('should silently ignore memory errors', async () => {
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async () => {
          throw new Error('Memory service unavailable');
        },
      });

      const handler = new PromptSubmitHandler(context, mockMemory);
      const request = new PromptSubmitRequest(
        'Test prompt',
        '2024-01-15T10:00:00.000Z'
      );

      // Should not throw
      const result = await handler.handle(request);

      assert.strictEqual(result.blocked, false);
      assert.strictEqual(result.content, 'Test prompt');
    });
  });

  describe('plan mode recursion', () => {
    it('should run recursion when in plan mode and shouldRun returns true', async () => {
      let recursionRan = false;
      const mockRecursion = createMockRecursionService({
        shouldRun: (prompt, mode) => mode === 'plan',
        run: async (prompt, groupIds) => {
          recursionRan = true;
          return createMockRecursionResult({
            hasContext: true,
            decisions: ['Previous decision 1'],
            summary: 'Found relevant context',
          });
        },
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Plan this feature',
        '2024-01-15T10:00:00.000Z',
        'session-123',
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(recursionRan, true, 'Recursion should have run');
      assert.strictEqual(result.planModeRecursion, true);
      assert.strictEqual(result.additionalContext, 'Found relevant context');
    });

    it('should pass hierarchical group IDs to recursion', async () => {
      let receivedGroupIds: readonly string[] | undefined;
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async (_prompt, groupIds) => {
          receivedGroupIds = groupIds;
          return createMockRecursionResult({ hasContext: true, summary: 'context' });
        },
      });

      const customContext = createMockContext({
        hierarchicalGroupIds: ['child-group', 'parent-group', 'root-group'],
      });

      const handler = new PromptSubmitHandler(customContext, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Test',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      await handler.handle(request);

      assert.deepStrictEqual(receivedGroupIds, ['child-group', 'parent-group', 'root-group']);
    });

    it('should not run recursion when shouldRun returns false', async () => {
      let recursionRan = false;
      const mockRecursion = createMockRecursionService({
        shouldRun: () => false,
        run: async () => {
          recursionRan = true;
          return createMockRecursionResult();
        },
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Short',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(recursionRan, false, 'Recursion should not have run');
      assert.strictEqual(result.planModeRecursion, false);
    });

    it('should not run recursion when not in plan mode', async () => {
      let recursionRan = false;
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => {
          recursionRan = true;
          return createMockRecursionResult({ hasContext: true });
        },
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Test prompt',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'default' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(recursionRan, false, 'Recursion should not run in default mode');
      assert.strictEqual(result.planModeRecursion, false);
    });

    it('should not set planModeRecursion when hasContext is false', async () => {
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => createMockRecursionResult({
          hasContext: false,
          summary: '',
        }),
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Test',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.planModeRecursion, false);
      assert.strictEqual(result.additionalContext, undefined);
    });

    it('should silently ignore recursion errors', async () => {
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => {
          throw new Error('Recursion service unavailable');
        },
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Test',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      // Should not throw
      const result = await handler.handle(request);

      assert.strictEqual(result.blocked, false);
      assert.strictEqual(result.planModeRecursion, false);
    });

    it('should include recursion result for backward compatibility', async () => {
      const expectedResult = createMockRecursionResult({
        hasContext: true,
        decisions: ['Decision 1'],
        learnings: ['Learning 1'],
        relatedTasks: ['Task 1'],
        summary: 'Summary',
      });

      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => expectedResult,
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion);
      const request = new PromptSubmitRequest(
        'Test',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.deepStrictEqual(result.recursion, expectedResult);
    });
  });

  describe('no recursion service', () => {
    it('should work without recursion service', async () => {
      const handler = new PromptSubmitHandler(context, memory);
      const request = new PromptSubmitRequest(
        'Test',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.strictEqual(result.planModeRecursion, false);
      assert.strictEqual(result.additionalContext, undefined);
    });
  });

  describe('task type detection (#180)', () => {
    it('should add taskType tag when detector is provided', async () => {
      let savedTags: string[] = [];
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, _fact, options) => {
          const opts = options as { tags: string[] };
          savedTags = opts.tags;
        },
      });

      const detector = createMockTaskTypeDetector({ taskType: 'debugging' });
      const handler = new PromptSubmitHandler(context, mockMemory, undefined, undefined, detector);
      const request = new PromptSubmitRequest('Fix the bug', '2024-01-15T10:00:00.000Z');

      await handler.handle(request);

      assert.ok(savedTags.includes('type:prompt'), 'Should have type:prompt tag');
      assert.ok(savedTags.includes('taskType:debugging'), 'Should have taskType:debugging tag');
    });

    it('should not add taskType tag when no detector provided', async () => {
      let savedTags: string[] = [];
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, _fact, options) => {
          const opts = options as { tags: string[] };
          savedTags = opts.tags;
        },
      });

      const handler = new PromptSubmitHandler(context, mockMemory);
      const request = new PromptSubmitRequest('Fix the bug', '2024-01-15T10:00:00.000Z');

      await handler.handle(request);

      assert.deepStrictEqual(savedTags, ['type:prompt']);
    });

    it('should add flag:decision for confirmation prompts', async () => {
      let savedTags: string[] = [];
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, _fact, options) => {
          const opts = options as { tags: string[] };
          savedTags = opts.tags;
        },
      });

      const detector = createMockTaskTypeDetector({ taskType: 'planning' });
      const handler = new PromptSubmitHandler(context, mockMemory, undefined, undefined, detector);
      const request = new PromptSubmitRequest('Yes, go ahead with that', '2024-01-15T10:00:00.000Z');

      await handler.handle(request);

      assert.ok(savedTags.includes('flag:decision'), 'Should have flag:decision tag');
    });

    it('should not add flag:decision for non-confirmation prompts', async () => {
      let savedTags: string[] = [];
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, _fact, options) => {
          const opts = options as { tags: string[] };
          savedTags = opts.tags;
        },
      });

      const detector = createMockTaskTypeDetector();
      const handler = new PromptSubmitHandler(context, mockMemory, undefined, undefined, detector);
      const request = new PromptSubmitRequest('Implement the caching layer', '2024-01-15T10:00:00.000Z');

      await handler.handle(request);

      assert.ok(!savedTags.includes('flag:decision'), 'Should not have flag:decision tag');
    });

    it('should pass detected taskType to recursion service', async () => {
      let receivedTaskType: string | undefined;
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async (_prompt, _groupIds, taskType) => {
          receivedTaskType = taskType;
          return createMockRecursionResult({ hasContext: true, summary: 'context' });
        },
      });

      const detector = createMockTaskTypeDetector({ taskType: 'planning' });
      const handler = new PromptSubmitHandler(context, memory, mockRecursion, logger, detector);
      const request = new PromptSubmitRequest(
        'Plan the feature',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      await handler.handle(request);

      assert.strictEqual(receivedTaskType, 'planning');
    });

    it('should detect various confirmation patterns for flag:decision', async () => {
      const confirmations = ['Yes', 'ok', 'Sounds good', 'Go ahead', 'Approved', 'Do that', 'Agreed'];

      for (const confirmation of confirmations) {
        let savedTags: string[] = [];
        const mockMemory = createMockMemoryService({
          addFactWithLifecycle: async (_groupId, _fact, options) => {
            const opts = options as { tags: string[] };
            savedTags = opts.tags;
          },
        });

        const handler = new PromptSubmitHandler(context, mockMemory);
        const request = new PromptSubmitRequest(confirmation, '2024-01-15T10:00:00.000Z');

        await handler.handle(request);

        assert.ok(
          savedTags.includes('flag:decision'),
          `Should detect decision for: "${confirmation}"`
        );
      }
    });

    it('should work with both detector and recursion service', async () => {
      let savedTags: string[] = [];
      const mockMemory = createMockMemoryService({
        addFactWithLifecycle: async (_groupId, _fact, options) => {
          const opts = options as { tags: string[] };
          savedTags = opts.tags;
        },
      });
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => createMockRecursionResult({ hasContext: true, summary: 'context' }),
      });

      const detector = createMockTaskTypeDetector({ taskType: 'debugging' });
      const handler = new PromptSubmitHandler(context, mockMemory, mockRecursion, logger, detector);
      const request = new PromptSubmitRequest(
        'Debug the issue',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.ok(savedTags.includes('taskType:debugging'));
      assert.ok(result.planModeRecursion);
    });
  });

  describe('proactive detection (#182)', () => {
    it('should append memory suggestion when proactive detection fires', async () => {
      const proactive = createMockProactiveDetector({
        shouldSuggest: true,
        suggestedFact: 'DECISION: Use Redis for caching',
        factType: 'decision',
        confidence: 'high',
      });

      const handler = new PromptSubmitHandler(context, memory, undefined, logger, undefined, proactive);
      const request = new PromptSubmitRequest(
        'Yes, go ahead',
        '2024-01-15T10:00:00.000Z',
        undefined,
        undefined,
        'We could use Redis or Memcached.'
      );

      const result = await handler.handle(request);

      assert.ok(result.additionalContext?.includes('[Memory suggestion:'));
      assert.ok(result.additionalContext?.includes('DECISION: Use Redis for caching'));
      assert.ok(result.additionalContext?.includes('/memory'));
    });

    it('should not add suggestion when detection returns shouldSuggest false', async () => {
      const proactive = createMockProactiveDetector({ shouldSuggest: false });

      const handler = new PromptSubmitHandler(context, memory, undefined, logger, undefined, proactive);
      const request = new PromptSubmitRequest('Just a normal prompt', '2024-01-15T10:00:00.000Z');

      const result = await handler.handle(request);

      assert.strictEqual(result.additionalContext, undefined);
    });

    it('should pass previousAssistantMessage to proactive detector', async () => {
      let receivedAssistant: string | undefined;
      const proactive: IProactiveDetector = {
        detect: (_prompt, assistant) => {
          receivedAssistant = assistant;
          return { shouldSuggest: false };
        },
      };

      const handler = new PromptSubmitHandler(context, memory, undefined, logger, undefined, proactive);
      const request = new PromptSubmitRequest(
        'Ok',
        '2024-01-15T10:00:00.000Z',
        undefined,
        undefined,
        'Here are some options...'
      );

      await handler.handle(request);

      assert.strictEqual(receivedAssistant, 'Here are some options...');
    });

    it('should append suggestion after recursion context', async () => {
      const mockRecursion = createMockRecursionService({
        shouldRun: () => true,
        run: async () => createMockRecursionResult({ hasContext: true, summary: 'Existing context' }),
      });

      const proactive = createMockProactiveDetector({
        shouldSuggest: true,
        suggestedFact: 'MILESTONE: All tests pass',
        factType: 'milestone',
      });

      const handler = new PromptSubmitHandler(context, memory, mockRecursion, logger, undefined, proactive);
      const request = new PromptSubmitRequest(
        'All tests pass now',
        '2024-01-15T10:00:00.000Z',
        undefined,
        'plan' as PermissionMode
      );

      const result = await handler.handle(request);

      assert.ok(result.additionalContext?.includes('Existing context'));
      assert.ok(result.additionalContext?.includes('[Memory suggestion:'));
    });

    it('should work without proactive detector (backward compatible)', async () => {
      const handler = new PromptSubmitHandler(context, memory);
      const request = new PromptSubmitRequest('Yes', '2024-01-15T10:00:00.000Z');

      const result = await handler.handle(request);

      assert.strictEqual(result.blocked, false);
      // No error thrown, no suggestion added
    });

    it('should include factType in suggestion text', async () => {
      const proactive = createMockProactiveDetector({
        shouldSuggest: true,
        suggestedFact: 'MILESTONE: PR #42 created',
        factType: 'milestone',
      });

      const handler = new PromptSubmitHandler(context, memory, undefined, logger, undefined, proactive);
      const request = new PromptSubmitRequest('Created PR #42', '2024-01-15T10:00:00.000Z');

      const result = await handler.handle(request);

      assert.ok(result.additionalContext?.includes('milestone'));
    });
  });

  describe('PromptSubmitRequest', () => {
    it('should create request with all parameters', () => {
      const request = new PromptSubmitRequest(
        'content',
        '2024-01-15T10:00:00.000Z',
        'session-123',
        'plan' as PermissionMode
      );

      assert.strictEqual(request.content, 'content');
      assert.strictEqual(request.timestamp, '2024-01-15T10:00:00.000Z');
      assert.strictEqual(request.sessionId, 'session-123');
      assert.strictEqual(request.permissionMode, 'plan');
    });

    it('should create request from event', () => {
      const event = {
        content: 'event content',
        timestamp: '2024-01-15T10:00:00.000Z' as const,
        sessionId: 'session-456',
        permissionMode: 'default' as PermissionMode,
      };

      const request = PromptSubmitRequest.fromEvent(event);

      assert.strictEqual(request.content, 'event content');
      assert.strictEqual(request.timestamp, '2024-01-15T10:00:00.000Z');
      assert.strictEqual(request.sessionId, 'session-456');
      assert.strictEqual(request.permissionMode, 'default');
    });

    it('should accept previousAssistantMessage parameter', () => {
      const request = new PromptSubmitRequest(
        'Yes',
        '2024-01-15T10:00:00.000Z',
        'session-123',
        'default' as PermissionMode,
        'Here are some options...'
      );

      assert.strictEqual(request.previousAssistantMessage, 'Here are some options...');
    });

    it('should pass previousAssistantMessage through fromEvent', () => {
      const event = {
        content: 'Ok',
        timestamp: '2024-01-15T10:00:00.000Z' as const,
        previousAssistantMessage: 'I suggest option A or option B.',
      };

      const request = PromptSubmitRequest.fromEvent(event);

      assert.strictEqual(request.previousAssistantMessage, 'I suggest option A or option B.');
    });
  });
});
