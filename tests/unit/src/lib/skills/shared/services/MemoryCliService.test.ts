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
  IMemoryLinkResult,
  IMemoryLinksResult,
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
  let linkCalls: Array<{ groupId: string; sourceUuid: string; targetUuid: string; relationType: string; metadata?: string }>;
  let linksCalls: Array<{ groupId: string; uuid: string; relationType?: string }>;

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
    linkFacts: async (groupId, sourceUuid, targetUuid, relationType, metadata): Promise<IMemoryLinkResult> => {
      linkCalls.push({ groupId, sourceUuid, targetUuid, relationType, metadata });
      return {
        status: 'ok',
        action: 'link',
        group: groupId,
        sourceUuid,
        targetUuid,
        relationType,
        mode: 'neo4j',
      };
    },
    getRelatedFacts: async (groupId, uuid, relationType): Promise<IMemoryLinksResult> => {
      linksCalls.push({ groupId, uuid, relationType });
      return {
        status: 'ok',
        action: 'links',
        group: groupId,
        uuid,
        relationships: [],
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
      note: null,
    };
  }

  beforeEach(() => {
    expireCalls = [];
    cleanupCalls = [];
    addCalls = [];
    linkCalls = [];
    linksCalls = [];
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

  describe('link command', () => {
    it('should call memoryService.linkFacts with parsed UUIDs', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'link',
        payload: 'uuid-a uuid-b',
        entityType: 'supersedes',
      });

      assert.strictEqual(linkCalls.length, 1);
      assert.strictEqual(linkCalls[0].sourceUuid, 'uuid-a');
      assert.strictEqual(linkCalls[0].targetUuid, 'uuid-b');
      assert.strictEqual(linkCalls[0].relationType, 'supersedes');
      assert.strictEqual(linkCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'link');
    });

    it('should default to relates_to when no --type provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'link',
        payload: 'uuid-a uuid-b',
      });

      assert.strictEqual(linkCalls[0].relationType, 'relates_to');
    });

    it('should pass note as metadata', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'link',
        payload: 'uuid-a uuid-b',
        note: 'Updated per review',
      });

      assert.strictEqual(linkCalls[0].metadata, 'Updated per review');
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'link',
        payload: 'uuid-a uuid-b',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(linkCalls[0].groupId, 'custom-group');
    });

    it('should throw if less than two UUIDs provided', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'link', payload: 'uuid-a' }),
        { message: /link requires two UUIDs/ }
      );
    });

    it('should throw if no UUIDs provided', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'link', payload: '' }),
        { message: /link requires two UUIDs/ }
      );
    });

    it('should throw for invalid relation type', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'link',
          payload: 'uuid-a uuid-b',
          entityType: 'invalid-type',
        }),
        { message: /Invalid relation type/ }
      );
    });
  });

  describe('links command', () => {
    it('should call memoryService.getRelatedFacts with uuid', async () => {
      const result = await cliService.run({
        ...defaultArgs(),
        command: 'links',
        uuid: 'uuid-a',
      });

      assert.strictEqual(linksCalls.length, 1);
      assert.strictEqual(linksCalls[0].uuid, 'uuid-a');
      assert.strictEqual(linksCalls[0].groupId, 'test-group');
      assert.strictEqual(result.action, 'links');
    });

    it('should use payload as uuid fallback', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'links',
        payload: 'uuid-b',
      });

      assert.strictEqual(linksCalls[0].uuid, 'uuid-b');
    });

    it('should pass relationType filter from --type', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'links',
        uuid: 'uuid-a',
        entityType: 'supersedes',
      });

      assert.strictEqual(linksCalls[0].relationType, 'supersedes');
    });

    it('should not filter when no --type provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'links',
        uuid: 'uuid-a',
      });

      assert.strictEqual(linksCalls[0].relationType, undefined);
    });

    it('should use explicit group if provided', async () => {
      await cliService.run({
        ...defaultArgs(),
        command: 'links',
        uuid: 'uuid-a',
        explicitGroup: 'custom-group',
      });

      assert.strictEqual(linksCalls[0].groupId, 'custom-group');
    });

    it('should throw if no uuid provided', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'links' }),
        { message: /links requires a UUID/ }
      );
    });

    it('should throw for invalid relation type filter', async () => {
      await assert.rejects(
        () => cliService.run({
          ...defaultArgs(),
          command: 'links',
          uuid: 'uuid-a',
          entityType: 'bad-type',
        }),
        { message: /Invalid relation type/ }
      );
    });
  });

  describe('invalid command', () => {
    it('should throw for unknown commands', async () => {
      await assert.rejects(
        () => cliService.run({ ...defaultArgs(), command: 'unknown' }),
        { message: /command must be add\|load\|expire\|cleanup\|link\|links/ }
      );
    });
  });
});
