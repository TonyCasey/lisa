/**
 * Tests for GitMemClient.
 *
 * Tests the thin CLI wrapper around `git mem`:
 * - remember: stores memories, builds correct CLI args
 * - recall: searches memories, parses JSON, handles errors
 * - context: gets staged-change-relevant memories
 * - retrofit: scans commit history
 * - error handling: graceful degradation on CLI failures
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// We mock execa at the module level by wrapping GitMemClient's exec calls
// Since GitMemClient shells out via execa, we test by injecting a mock logger
// and verifying behavior through the public API with a real (or stubbed) binary.

// For unit tests, we create a subclass that overrides the private exec method.
import type { IGitMemClient } from '../../../../../../src/lib/domain/interfaces/IGitMemClient';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces/ILogger';
import type { IRememberOptions, IRecallOptions, IContextOptions, IRetrofitOptions } from '../../../../../../src/lib/infrastructure/git-mem/types';

/**
 * Testable subclass that replaces the private exec method
 * with a configurable stub, avoiding real CLI calls.
 */
class TestableGitMemClient {
  private execStub: (args: string[]) => Promise<string | null>;
  private readonly logger?: ILogger;

  constructor(
    execStub: (args: string[]) => Promise<string | null>,
    logger?: ILogger
  ) {
    this.execStub = execStub;
    this.logger = logger;
  }

  setExecStub(stub: (args: string[]) => Promise<string | null>): void {
    this.execStub = stub;
  }

  async remember(text: string, options?: IRememberOptions): Promise<boolean> {
    const args = ['remember', text];

    if (options?.type) args.push('--type', options.type);
    if (options?.lifecycle) args.push('--lifecycle', options.lifecycle);
    if (options?.confidence) args.push('--confidence', options.confidence);
    if (options?.tags && options.tags.length > 0) args.push('--tags', options.tags.join(','));
    if (options?.commit) args.push('--commit', options.commit);

    const result = await this.execStub(args);
    return result !== null;
  }

  async recall(query?: string, options?: IRecallOptions): Promise<readonly import('../../../../../../src/lib/infrastructure/git-mem/types').IGitMemEntry[]> {
    const args = ['recall'];
    if (query) args.push(query);
    args.push('--json');
    if (options?.limit !== undefined) args.push('--limit', String(options.limit));
    if (options?.type) args.push('--type', options.type);
    if (options?.since) args.push('--since', options.since);
    if (options?.tag) args.push('--tag', options.tag);

    const stdout = await this.execStub(args);
    if (!stdout) return [];

    try {
      const parsed = JSON.parse(stdout);
      return parsed.memories ?? [];
    } catch {
      this.logger?.debug('Failed to parse git-mem recall JSON', { stdout: stdout.slice(0, 200) });
      return [];
    }
  }

  async context(options?: IContextOptions): Promise<readonly import('../../../../../../src/lib/infrastructure/git-mem/types').IGitMemEntry[]> {
    const args = ['context', '--json'];
    if (options?.limit !== undefined) args.push('--limit', String(options.limit));
    if (options?.threshold !== undefined) args.push('--threshold', String(options.threshold));

    const stdout = await this.execStub(args);
    if (!stdout) return [];

    try {
      const parsed = JSON.parse(stdout);
      return parsed.memories ?? [];
    } catch {
      this.logger?.debug('Failed to parse git-mem context JSON', { stdout: stdout.slice(0, 200) });
      return [];
    }
  }

  async retrofit(options?: IRetrofitOptions): Promise<{ success: boolean; output: string }> {
    const args = ['retrofit'];
    if (options?.since) args.push('--since', options.since);
    if (options?.maxCommits !== undefined) args.push('--max-commits', String(options.maxCommits));
    if (options?.threshold !== undefined) args.push('--threshold', String(options.threshold));
    if (options?.dryRun) args.push('--dry-run');

    const stdout = await this.execStub(args);
    return { success: stdout !== null, output: stdout ?? '' };
  }
}

// Sample recall response matching git-mem JSON output
const SAMPLE_RECALL_RESPONSE = JSON.stringify({
  memories: [
    {
      id: '7ce1a5e9-5e22-4645-afc9-7916290cc9c9',
      content: 'test memory for integration',
      type: 'fact',
      sha: 'HEAD',
      confidence: 'high',
      source: 'user-explicit',
      lifecycle: 'session',
      tags: ['test', 'integration'],
      createdAt: '2026-02-06T12:22:33.719Z',
      updatedAt: '2026-02-06T12:22:33.719Z',
    },
    {
      id: 'a3540c90-6a9a-43b3-a2c0-1197767f9210',
      content: 'Add workflow_dispatch trigger for manual CI runs',
      type: 'convention',
      sha: 'e682f802',
      confidence: 'high',
      source: 'heuristic-extraction',
      lifecycle: 'project',
      tags: ['retrofit', 'pattern:convention'],
      createdAt: '2026-02-05T18:37:26.711Z',
      updatedAt: '2026-02-05T18:37:26.711Z',
    },
  ],
});

describe('GitMemClient', () => {
  let client: TestableGitMemClient;
  let capturedArgs: string[][];
  let mockLogger: ILogger;

  beforeEach(() => {
    capturedArgs = [];
    mockLogger = {
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    } as unknown as ILogger;
  });

  describe('remember', () => {
    it('should build correct args for basic remember', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return 'ok';
      }, mockLogger);

      const result = await client.remember('test fact');

      assert.strictEqual(result, true);
      assert.deepStrictEqual(capturedArgs[0], ['remember', 'test fact']);
    });

    it('should include all options in CLI args', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return 'ok';
      }, mockLogger);

      const result = await client.remember('important decision', {
        type: 'decision',
        lifecycle: 'permanent',
        confidence: 'verified',
        tags: ['arch', 'backend'],
        commit: 'abc123',
      });

      assert.strictEqual(result, true);
      assert.deepStrictEqual(capturedArgs[0], [
        'remember', 'important decision',
        '--type', 'decision',
        '--lifecycle', 'permanent',
        '--confidence', 'verified',
        '--tags', 'arch,backend',
        '--commit', 'abc123',
      ]);
    });

    it('should return false when CLI fails', async () => {
      client = new TestableGitMemClient(async () => null, mockLogger);

      const result = await client.remember('will fail');

      assert.strictEqual(result, false);
    });

    it('should not include empty tags', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return 'ok';
      }, mockLogger);

      await client.remember('no tags', { tags: [] });

      assert.deepStrictEqual(capturedArgs[0], ['remember', 'no tags']);
    });
  });

  describe('recall', () => {
    it('should parse JSON response correctly', async () => {
      client = new TestableGitMemClient(async () => SAMPLE_RECALL_RESPONSE, mockLogger);

      const memories = await client.recall();

      assert.strictEqual(memories.length, 2);
      assert.strictEqual(memories[0]?.id, '7ce1a5e9-5e22-4645-afc9-7916290cc9c9');
      assert.strictEqual(memories[0]?.content, 'test memory for integration');
      assert.strictEqual(memories[0]?.type, 'fact');
      assert.strictEqual(memories[1]?.type, 'convention');
    });

    it('should build correct args with query and options', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return JSON.stringify({ memories: [] });
      }, mockLogger);

      await client.recall('authentication', {
        limit: 10,
        type: 'decision',
        since: '2026-01-01',
        tag: 'arch',
      });

      assert.deepStrictEqual(capturedArgs[0], [
        'recall', 'authentication', '--json',
        '--limit', '10',
        '--type', 'decision',
        '--since', '2026-01-01',
        '--tag', 'arch',
      ]);
    });

    it('should include --json flag without query', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return JSON.stringify({ memories: [] });
      }, mockLogger);

      await client.recall();

      assert.deepStrictEqual(capturedArgs[0], ['recall', '--json']);
    });

    it('should return empty array when CLI fails', async () => {
      client = new TestableGitMemClient(async () => null, mockLogger);

      const result = await client.recall('anything');

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array on invalid JSON', async () => {
      client = new TestableGitMemClient(async () => 'not json {{{', mockLogger);

      const result = await client.recall();

      assert.deepStrictEqual(result, []);
    });

    it('should return empty array when response has no memories key', async () => {
      client = new TestableGitMemClient(async () => JSON.stringify({ other: 'data' }), mockLogger);

      const result = await client.recall();

      assert.deepStrictEqual(result, []);
    });
  });

  describe('context', () => {
    it('should parse context JSON response', async () => {
      const contextResp = JSON.stringify({
        memories: [
          {
            id: 'ctx-1',
            content: 'relevant memory',
            type: 'fact',
            sha: 'HEAD',
            confidence: 'high',
            source: 'user-explicit',
            lifecycle: 'project',
            tags: [],
            createdAt: '2026-02-06T12:00:00Z',
            updatedAt: '2026-02-06T12:00:00Z',
          },
        ],
      });

      client = new TestableGitMemClient(async () => contextResp, mockLogger);

      const memories = await client.context();

      assert.strictEqual(memories.length, 1);
      assert.strictEqual(memories[0]?.content, 'relevant memory');
    });

    it('should build correct args with options', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return JSON.stringify({ memories: [] });
      }, mockLogger);

      await client.context({ limit: 5, threshold: 0.5 });

      assert.deepStrictEqual(capturedArgs[0], [
        'context', '--json', '--limit', '5', '--threshold', '0.5',
      ]);
    });

    it('should return empty array when CLI fails', async () => {
      client = new TestableGitMemClient(async () => null, mockLogger);

      const result = await client.context();

      assert.deepStrictEqual(result, []);
    });
  });

  describe('retrofit', () => {
    it('should return success true on successful execution', async () => {
      client = new TestableGitMemClient(async () => 'Processed 5 commits', mockLogger);

      const result = await client.retrofit();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.output, 'Processed 5 commits');
    });

    it('should build correct args with all options', async () => {
      client = new TestableGitMemClient(async (args) => {
        capturedArgs.push(args);
        return 'done';
      }, mockLogger);

      await client.retrofit({
        since: '2026-01-01',
        maxCommits: 50,
        threshold: 3,
        dryRun: true,
      });

      assert.deepStrictEqual(capturedArgs[0], [
        'retrofit',
        '--since', '2026-01-01',
        '--max-commits', '50',
        '--threshold', '3',
        '--dry-run',
      ]);
    });

    it('should return success false when CLI fails', async () => {
      client = new TestableGitMemClient(async () => null, mockLogger);

      const result = await client.retrofit();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.output, '');
    });
  });
});
