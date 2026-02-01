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
  IMemoryConflictsResult,
  IMemoryDedupeResult,
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
  let conflictsCalls: Array<{ groupIds: string[]; topic?: string }>;
  let dedupeCalls: Array<{ groupId: string; options?: unknown }>;

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
    conflicts: async (groupIds, topic): Promise<IMemoryConflictsResult> => {
      conflictsCalls.push({ groupIds, topic });
      return {
        status: 'ok',
        action: 'conflicts',
        group: groupIds[0] || '',
        groups: groupIds,
        topic: topic || '',
        conflictGroups: [],
        totalConflicts: 0,
        mode: 'neo4j',
      };
    },
    dedupe: async (groupId, options): Promise<IMemoryDedupeResult> => {
      dedupeCalls.push({ groupId, options });
      return {
        status: 'ok',
        action: 'dedupe',
        group: groupId,
        totalFactsScanned: 0,
        duplicateGroups: [],
        totalDuplicates: 0,
        minSimilarity: (options as Record<string, unknown>)?.minSimilarity as number ?? 0.6,
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
      topic: null,
      minSimilarity: null,
    };
  }

  beforeEach(() => {
    expireCalls = [];
    cleanupCalls = [];
    addCalls = [];
    conflictsCalls = [];
    dedupeCalls = [];
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

  describe('conflicts command', () => {
    it('should call memoryService.conflicts with default group IDs', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
      });

      assert.strictEqual(conflictsCalls.length, 1);
      assert.deepStrictEqual(conflictsCalls[0].groupIds, ['test-group']);
      assert.strictEqual(conflictsCalls[0].topic, undefined);
      assert.strictEqual(result.action, 'conflicts');
    });

    it('should pass topic when --topic is provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
        topic: 'type:decision',
      });

      assert.strictEqual(conflictsCalls.length, 1);
      assert.strictEqual(conflictsCalls[0].topic, 'type:decision');
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'conflicts',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(conflictsCalls.length, 1);
      assert.deepStrictEqual(conflictsCalls[0].groupIds, ['custom-group']);
    });
  });

  describe('dedupe command', () => {
    it('should call memoryService.dedupe with default options', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'dedupe',
      });

      assert.strictEqual(dedupeCalls.length, 1);
      assert.strictEqual(dedupeCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'dedupe');
    });

    it('should pass minSimilarity when provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'dedupe',
        minSimilarity: 0.8,
      });

      assert.strictEqual(dedupeCalls.length, 1);
      const opts = dedupeCalls[0].options as Record<string, unknown>;
      assert.strictEqual(opts.minSimilarity, 0.8);
    });

    it('should pass limit when provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'dedupe',
        limit: 5,
      });

      assert.strictEqual(dedupeCalls.length, 1);
      const opts = dedupeCalls[0].options as Record<string, unknown>;
      assert.strictEqual(opts.limit, 5);
    });

    it('should pass since date when provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'dedupe',
        since: '7d',
      });

      assert.strictEqual(dedupeCalls.length, 1);
      const opts = dedupeCalls[0].options as Record<string, unknown>;
      assert.ok(opts.since instanceof Date);
    });

    it('should throw for invalid --since date', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'dedupe',
          since: 'not-a-date',
        }),
        { message: /Invalid --since date/ }
      );
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'dedupe',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(dedupeCalls[0].groupId, 'custom-group');
    });
  });

  describe('invalid command', () => {
    it('should throw for unknown commands', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'unknown' }),
        { message: /command must be add\|load\|expire\|cleanup\|conflicts\|dedupe/ }
      );
    });
  });
});
