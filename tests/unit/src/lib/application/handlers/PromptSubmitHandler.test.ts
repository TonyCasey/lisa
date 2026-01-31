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
  });
});
