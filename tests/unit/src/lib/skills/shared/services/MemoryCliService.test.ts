/**
 * Tests for MemoryCliService - parseTtlDuration and expire/cleanup commands.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createMemoryCliService,
  parseTtlDuration,
} from '../../../../../../../src/lib/skills/shared/services/MemoryCliService';
import type { IEnvConfig } from '../../../../../../../src/lib/skills/shared/utils/env';
import type { ILogger } from '../../../../../../../src/lib/skills/shared/utils/interfaces/ILogger';
import type { ICache } from '../../../../../../../src/lib/skills/shared/utils/cache';
import type {
  IMemoryService,
  IMemoryLoadResult,
  IMemoryAddResult,
  IMemoryExpireResult,
  IMemoryCleanupResult,
  IMemoryVerifyResult,
  IMemoryCurateResult,
  IMemoryConflictsResult,
} from '../../../../../../../src/lib/skills/shared/services/interfaces';

const noopLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const noopCache: ICache = {
  write: () => {},
  readFallback: () => null,
};

const env: IEnvConfig = {
  STORAGE_MODE: 'local',
  GRAPHITI_ENDPOINT: 'http://localhost:8010/mcp/',
  NEO4J_URI: 'bolt://localhost:7687',
  NEO4J_USER: 'neo4j',
  NEO4J_PASSWORD: 'demodemo',
  NEO4J_DATABASE: 'neo4j',
  LOG_LEVEL: 'silent',
  LOG_CONSOLE: false,
  raw: {},
};

// --- parseTtlDuration tests ---

describe('parseTtlDuration', () => {
  it('should parse seconds', () => {
    assert.strictEqual(parseTtlDuration('30s'), 30_000);
    assert.strictEqual(parseTtlDuration('1sec'), 1_000);
  });

  it('should parse minutes', () => {
    assert.strictEqual(parseTtlDuration('5m'), 300_000);
    assert.strictEqual(parseTtlDuration('1min'), 60_000);
  });

  it('should parse hours', () => {
    assert.strictEqual(parseTtlDuration('2h'), 7_200_000);
    assert.strictEqual(parseTtlDuration('1hr'), 3_600_000);
  });

  it('should parse days', () => {
    assert.strictEqual(parseTtlDuration('7d'), 604_800_000);
    assert.strictEqual(parseTtlDuration('1d'), 86_400_000);
  });

  it('should parse weeks', () => {
    assert.strictEqual(parseTtlDuration('1w'), 604_800_000);
    assert.strictEqual(parseTtlDuration('2w'), 1_209_600_000);
  });

  it('should parse plain number as milliseconds', () => {
    assert.strictEqual(parseTtlDuration('5000'), 5_000);
    assert.strictEqual(parseTtlDuration('0'), 0);
  });

  it('should handle fractional values', () => {
    assert.strictEqual(parseTtlDuration('1.5h'), 5_400_000);
    assert.strictEqual(parseTtlDuration('0.5d'), 43_200_000);
  });

  it('should handle whitespace', () => {
    assert.strictEqual(parseTtlDuration('  2h  '), 7_200_000);
  });

  it('should be case-insensitive', () => {
    assert.strictEqual(parseTtlDuration('2H'), 7_200_000);
    assert.strictEqual(parseTtlDuration('5M'), 300_000);
  });

  it('should return null for invalid input', () => {
    assert.strictEqual(parseTtlDuration(''), null);
    assert.strictEqual(parseTtlDuration('abc'), null);
    assert.strictEqual(parseTtlDuration('h'), null);
    assert.strictEqual(parseTtlDuration('5x'), null);
  });
});

// --- MemoryCliService expire/cleanup command tests ---

describe('MemoryCliService', () => {
  let expireCalls: Array<{ groupId: string; uuid: string }>;
  let cleanupCalls: Array<{ groupId: string; dryRun: boolean }>;
  let addCalls: Array<{ text: string; groupId: string; options: unknown }>;
  let verifyCalls: Array<{ groupId: string; uuid: string }>;
  let curateCalls: Array<{ groupId: string; groupIds: string[]; options: unknown }>;
  let conflictsCalls: Array<{ groupIds: string[]; topic?: string }>;

  const memoryService: IMemoryService = {
    load: async (groupIds): Promise<IMemoryLoadResult> => ({
      status: 'ok',
      action: 'load',
      group: groupIds[0] || '',
      groups: groupIds,
      query: '',
      facts: [],
      mode: 'neo4j',
    }),
    add: async (text, groupId, options): Promise<IMemoryAddResult> => {
      addCalls.push({ text, groupId, options });
      return {
        status: 'ok',
        action: 'add',
        group: groupId,
        text,
        mode: 'mcp',
      };
    },
    expire: async (groupId, uuid): Promise<IMemoryExpireResult> => {
      expireCalls.push({ groupId, uuid });
      return {
        status: 'ok',
        action: 'expire',
        group: groupId,
        uuid,
        found: true,
        mode: 'neo4j',
      };
    },
    cleanup: async (groupId, dryRun): Promise<IMemoryCleanupResult> => {
      cleanupCalls.push({ groupId, dryRun });
      return {
        status: 'ok',
        action: 'cleanup',
        group: groupId,
        expiredCount: 3,
        dryRun,
        mode: 'neo4j',
      };
    },
    verify: async (groupId, uuid): Promise<IMemoryVerifyResult> => {
      verifyCalls.push({ groupId, uuid });
      return {
        status: 'ok',
        action: 'verify',
        group: groupId,
        uuid,
        previousConfidence: 'medium',
        newConfidence: 'verified',
        mode: 'neo4j',
      };
    },
    curate: async (groupId, groupIds, options): Promise<IMemoryCurateResult> => {
      curateCalls.push({ groupId, groupIds, options });
      return {
        status: 'ok',
        action: 'curate',
        group: groupId,
        facts: [],
        totalReviewed: 0,
        mode: 'neo4j',
      };
    },
    conflicts: async (groupIds, topic): Promise<IMemoryConflictsResult> => {
      conflictsCalls.push({ groupIds, topic });
      return {
        status: 'ok',
        action: 'conflicts',
        group: groupIds[0] || '',
        conflicts: [],
        totalGroups: 0,
        mode: 'neo4j',
      };
    },
  };

  function defaultArgs() {
    return {
      command: 'load',
      payload: '',
      explicitGroup: null,
      query: '',
      limit: 10,
      explicitTag: null,
      entityType: null,
      source: 'test',
      since: null,
      until: null,
      lifecycle: null,
      ttl: null,
      dryRun: false,
      uuid: null,
      confidence: null,
      sourceType: null,
      minConfidence: null,
      showMetadata: false,
      topic: null,
    };
  }

  beforeEach(() => {
    expireCalls = [];
    cleanupCalls = [];
    addCalls = [];
    verifyCalls = [];
    curateCalls = [];
    conflictsCalls = [];
  });

  const cliService = createMemoryCliService({
    env,
    logger: noopLogger,
    cache: noopCache,
    memoryService,
    getGroupIds: () => ['test-group'],
    getCurrentGroupId: () => 'test-group',
    resolveTag: (_text, explicitTag, entityType) => {
      if (explicitTag) return explicitTag;
      if (entityType === 'session') return 'lifecycle:session';
      return undefined;
    },
  });

  describe('expire command', () => {
    it('should call memoryService.expire with uuid from --uuid flag', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'expire',
        uuid: 'abc-123',
      });

      assert.strictEqual(expireCalls.length, 1);
      assert.strictEqual(expireCalls[0].uuid, 'abc-123');
      assert.strictEqual(expireCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'expire');
    });

    it('should use payload as uuid fallback', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'expire',
        payload: 'def-456',
      });

      assert.strictEqual(expireCalls.length, 1);
      assert.strictEqual(expireCalls[0].uuid, 'def-456');
      assert.strictEqual(result.action, 'expire');
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'expire',
        uuid: 'abc-123',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(expireCalls[0].groupId, 'custom-group');
    });

    it('should throw if no uuid provided', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'expire' }),
        { message: /expire requires a UUID/ }
      );
    });
  });

  describe('cleanup command', () => {
    it('should call memoryService.cleanup with dryRun=false by default', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'cleanup',
      });

      assert.strictEqual(cleanupCalls.length, 1);
      assert.strictEqual(cleanupCalls[0].dryRun, false);
      assert.strictEqual(cleanupCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'cleanup');
    });

    it('should pass dryRun=true when --dry-run is set', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'cleanup',
        dryRun: true,
      });

      assert.strictEqual(cleanupCalls.length, 1);
      assert.strictEqual(cleanupCalls[0].dryRun, true);
      const cleanupResult = result as IMemoryCleanupResult;
      assert.strictEqual(cleanupResult.dryRun, true);
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'cleanup',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(cleanupCalls[0].groupId, 'custom-group');
    });
  });

  describe('add with --lifecycle flag', () => {
    it('should resolve lifecycle type when --lifecycle is provided without --type', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'add',
        payload: 'test memory',
        lifecycle: 'session',
      });

      assert.strictEqual(addCalls.length, 1);
      assert.deepStrictEqual(addCalls[0].options, {
        tag: 'lifecycle:session',
        type: 'session',
        source: 'test',
        ttl: undefined,
        confidence: undefined,
        sourceType: undefined,
      });
    });
  });

  describe('add with --ttl flag', () => {
    it('should pass parsed TTL to memoryService.add', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'add',
        payload: 'test memory',
        ttl: '2h',
      });

      assert.strictEqual(addCalls.length, 1);
      assert.strictEqual((addCalls[0].options as Record<string, unknown>).ttl, 7_200_000);
    });

    it('should throw for invalid TTL duration', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'add',
          payload: 'test memory',
          ttl: 'invalid',
        }),
        { message: /Invalid --ttl duration/ }
      );
    });
  });

  describe('verify command', () => {
    it('should call memoryService.verify with uuid from --uuid flag', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'verify',
        uuid: 'abc-123',
      });

      assert.strictEqual(verifyCalls.length, 1);
      assert.strictEqual(verifyCalls[0].uuid, 'abc-123');
      assert.strictEqual(verifyCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'verify');
    });

    it('should use payload as uuid fallback', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'verify',
        payload: 'def-456',
      });

      assert.strictEqual(verifyCalls.length, 1);
      assert.strictEqual(verifyCalls[0].uuid, 'def-456');
      assert.strictEqual(result.action, 'verify');
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'verify',
        uuid: 'abc-123',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(verifyCalls[0].groupId, 'custom-group');
    });

    it('should throw if no uuid provided', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'verify' }),
        { message: /verify requires a UUID/ }
      );
    });
  });

  describe('curate command', () => {
    it('should call memoryService.curate with default options', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'curate',
      });

      assert.strictEqual(curateCalls.length, 1);
      assert.strictEqual(curateCalls[0].groupId, 'test-group');
      assert.deepStrictEqual(curateCalls[0].groupIds, ['test-group']);
      assert.deepStrictEqual(curateCalls[0].options, {
        since: undefined,
        minConfidence: undefined,
        limit: 10,
      });
      assert.strictEqual(result.action, 'curate');
    });

    it('should pass since and limit options', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'curate',
        since: '7d',
        limit: 25,
      });

      assert.strictEqual(curateCalls.length, 1);
      assert.deepStrictEqual(curateCalls[0].options, {
        since: '7d',
        minConfidence: undefined,
        limit: 25,
      });
    });

    it('should pass minConfidence when valid', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'curate',
        minConfidence: 'low',
      });

      assert.strictEqual(curateCalls.length, 1);
      assert.strictEqual((curateCalls[0].options as Record<string, unknown>).minConfidence, 'low');
    });

    it('should throw for invalid minConfidence in curate', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'curate',
          minConfidence: 'bogus',
        }),
        { message: /Invalid --min-confidence/ }
      );
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'curate',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(curateCalls[0].groupId, 'custom-group');
      assert.deepStrictEqual(curateCalls[0].groupIds, ['custom-group']);
    });
  });

  describe('conflicts command', () => {
    it('should call memoryService.conflicts with default group', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
      });

      assert.strictEqual(conflictsCalls.length, 1);
      assert.deepStrictEqual(conflictsCalls[0].groupIds, ['test-group']);
      assert.strictEqual(conflictsCalls[0].topic, undefined);
      assert.strictEqual(result.action, 'conflicts');
    });

    it('should pass topic filter', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
        topic: 'authentication',
      });

      assert.strictEqual(conflictsCalls.length, 1);
      assert.strictEqual(conflictsCalls[0].topic, 'authentication');
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
        explicitGroup: 'custom-group',
      });

      assert.deepStrictEqual(conflictsCalls[0].groupIds, ['custom-group']);
    });
  });

  describe('add with --confidence flag', () => {
    it('should pass confidence to memoryService.add', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'add',
        payload: 'test memory',
        confidence: 'high',
      });

      assert.strictEqual(addCalls.length, 1);
      assert.strictEqual((addCalls[0].options as Record<string, unknown>).confidence, 'high');
    });

    it('should throw for invalid confidence value', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'add',
          payload: 'test memory',
          confidence: 'invalid',
        }),
        { message: /Invalid --confidence/ }
      );
    });
  });

  describe('add with --source-type flag', () => {
    it('should pass sourceType to memoryService.add', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'add',
        payload: 'test memory',
        sourceType: 'user-explicit',
      });

      assert.strictEqual(addCalls.length, 1);
      assert.strictEqual((addCalls[0].options as Record<string, unknown>).sourceType, 'user-explicit');
    });

    it('should throw for invalid source-type value', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'add',
          payload: 'test memory',
          sourceType: 'invalid',
        }),
        { message: /Invalid --source-type/ }
      );
    });
  });

  describe('load with --min-confidence flag', () => {
    it('should pass minConfidence to memoryService.load', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'load',
        minConfidence: 'medium',
      });

      // load should succeed without error - validates the value is accepted
    });

    it('should throw for invalid min-confidence value', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'load',
          minConfidence: 'bogus',
        }),
        { message: /Invalid --min-confidence/ }
      );
    });
  });

  describe('invalid command', () => {
    it('should throw for unknown commands', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'unknown' }),
        { message: /command must be/ }
      );
    });
  });
});
