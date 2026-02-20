/**
 * Tests for TaskCliService default date filtering.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTaskCliService } from '../../../../../../../src/lib/skills/shared/services/TaskCliService';
import { parseDate } from '../../../../../../../src/lib/utils/dateParser';
import type { IEnvConfig } from '../../../../../../../src/lib/skills/shared/utils/env';
import type { ILogger } from '../../../../../../../src/lib/skills/shared/utils/interfaces/ILogger';
import type { ICache } from '../../../../../../../src/lib/skills/shared/utils/cache';
import type {
  ITaskService,
  ITaskListResult,
  ITaskWriteResult,
  ITaskLinkResult,
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

function createTaskServiceRecorder() {
  const listCalls: Array<{ limit: number; options?: unknown }> = [];

  const service: ITaskService = {
    list: async (limit, _repo, _assignee, options): Promise<ITaskListResult> => {
      listCalls.push({ limit, options });
      return {
        status: 'ok',
        action: 'list',
        tasks: [],
        mode: 'git-mem',
      };
    },
    listLinked: async (): Promise<ITaskListResult> => ({
      status: 'ok',
      action: 'list',
      tasks: [],
      mode: 'git-mem',
    }),
    add: async (): Promise<ITaskWriteResult> => ({
      status: 'ok',
      action: 'add',
      task: { type: 'task', title: 'x', status: 'todo', repo: '', assignee: '' },
      mode: 'git-mem',
    }),
    update: async (): Promise<ITaskWriteResult> => ({
      status: 'ok',
      action: 'update',
      task: { type: 'task', title: 'x', status: 'todo', repo: '', assignee: '' },
      mode: 'git-mem',
    }),
    link: async (): Promise<ITaskLinkResult> => ({
      status: 'ok',
      action: 'link',
      task: { title: 'x', uuid: 'task-1' },
      mode: 'git-mem',
    }),
    unlink: async (): Promise<ITaskLinkResult> => ({
      status: 'ok',
      action: 'unlink',
      task: { title: 'x', uuid: 'task-1' },
      mode: 'git-mem',
    }),
  };

  return { service, listCalls };
}

describe('TaskCliService list defaults', () => {
  it('defaults to since today when no date flags are provided', async () => {
    const { service, listCalls } = createTaskServiceRecorder();
    const cli = createTaskCliService({
      env,
      logger: noopLogger,
      cache: noopCache,
      taskService: service,
    });

    await cli.run({
      command: 'list',
      payload: '',
      limit: 20,
      status: 'todo',
      tag: null,
      repo: 'owner/repo',
      assignee: 'alice',
      notes: '',
      link: null,
      linkedSource: null,
      since: null,
      until: null,
      all: false,
    });

    assert.strictEqual(listCalls.length, 1);
    const options = listCalls[0].options as { since?: Date } | undefined;
    const expected = parseDate('today');
    assert.ok(options?.since);
    assert.strictEqual(options?.since?.getTime(), expected?.getTime());
  });

  it('skips default since when --all is set', async () => {
    const { service, listCalls } = createTaskServiceRecorder();
    const cli = createTaskCliService({
      env,
      logger: noopLogger,
      cache: noopCache,
      taskService: service,
    });

    await cli.run({
      command: 'list',
      payload: '',
      limit: 20,
      status: 'todo',
      tag: null,
      repo: 'owner/repo',
      assignee: 'alice',
      notes: '',
      link: null,
      linkedSource: null,
      since: null,
      until: null,
      all: true,
    });

    assert.strictEqual(listCalls.length, 1);
    const options = listCalls[0].options as { since?: Date } | undefined;
    assert.strictEqual(options?.since, undefined);
  });
});
