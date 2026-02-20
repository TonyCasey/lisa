/**
 * Tests for GitHub issue task persistence helper.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { persistCreatedIssueTask } from '../../../../../../src/lib/skills/github/github';
import type {
  ITaskService,
  ITask,
  ITaskListResult,
  ITaskWriteResult,
  ITaskWriteOptions,
  ITaskLinkResult,
  ExternalLinkSource,
} from '../../../../../../src/lib/skills/shared/services/interfaces';

interface ITaskCall {
  title: string;
  options: ITaskWriteOptions;
}

function createMockTask(overrides: Partial<ITask> = {}): ITask {
  return {
    title: 'Existing Task',
    status: 'todo',
    repo: 'owner/repo',
    assignee: 'alice',
    uuid: 'task-1',
    created_at: '2026-01-30T10:00:00Z',
    externalLink: {
      source: 'github',
      id: '42',
      url: 'https://github.com/owner/repo/issues/42',
    },
    ...overrides,
  };
}

function createMockTaskService(linkedTasks: ITask[] = []) {
  const addCalls: ITaskCall[] = [];
  const updateCalls: ITaskCall[] = [];
  const listLinkedCalls: Array<{
    source: ExternalLinkSource | undefined;
  }> = [];

  const service: ITaskService = {
    list: async (): Promise<ITaskListResult> => ({
      status: 'ok',
      action: 'list',
      tasks: [],
      mode: 'git-mem',
    }),
    add: async (title: string, options: ITaskWriteOptions): Promise<ITaskWriteResult> => {
      addCalls.push({ title, options });
      return {
        status: 'ok',
        action: 'add',
        task: {
          type: 'task',
          title,
          status: options.status || 'todo',
          repo: options.repo || '',
          assignee: options.assignee || '',
        },
        mode: 'git-mem',
      };
    },
    update: async (title: string, options: ITaskWriteOptions): Promise<ITaskWriteResult> => {
      updateCalls.push({ title, options });
      return {
        status: 'ok',
        action: 'update',
        task: {
          type: 'task',
          title,
          status: options.status || 'todo',
          repo: options.repo || '',
          assignee: options.assignee || '',
        },
        mode: 'git-mem',
      };
    },
    link: async (): Promise<ITaskLinkResult> => {
      throw new Error('link should not be called');
    },
    unlink: async (): Promise<ITaskLinkResult> => {
      throw new Error('unlink should not be called');
    },
    listLinked: async (
      source: ExternalLinkSource | undefined
    ): Promise<ITaskListResult> => {
      listLinkedCalls.push({ source });
      return {
        status: 'ok',
        action: 'list',
        tasks: linkedTasks,
        mode: 'git-mem',
      };
    },
  };

  return { service, addCalls, updateCalls, listLinkedCalls };
}

describe('persistCreatedIssueTask', () => {
  it('adds a task when no linked task exists', async () => {
    const { service, addCalls, updateCalls, listLinkedCalls } = createMockTaskService();

    await persistCreatedIssueTask({
      tasks: service,
      repo: 'owner/repo',
      issue: {
        number: 42,
        url: 'https://github.com/owner/repo/issues/42',
        title: 'Issue title',
        body: 'Issue body',
        assignee: 'alice',
      },
    });

    assert.strictEqual(updateCalls.length, 0);
    assert.strictEqual(addCalls.length, 1);
    const call = addCalls[0];
    assert.strictEqual(call.title, 'Issue title');
    assert.strictEqual(call.options.repo, 'owner/repo');
    assert.strictEqual(call.options.assignee, 'alice');
    assert.strictEqual(call.options.notes, 'Issue body');
    assert.strictEqual(call.options.externalLink?.source, 'github');
    assert.strictEqual(call.options.externalLink?.id, '42');
    assert.strictEqual(call.options.externalLink?.url, 'https://github.com/owner/repo/issues/42');
    assert.strictEqual(listLinkedCalls.length, 1);
    assert.strictEqual(listLinkedCalls[0].source, 'github');
  });

  it('skips persistence when a linked task already exists (idempotent)', async () => {
    const existing = createMockTask({
      externalLink: {
        source: 'github',
        id: '42',
        url: 'https://github.com/owner/repo/issues/42',
      },
    });
    const { service, addCalls, updateCalls, listLinkedCalls } = createMockTaskService([existing]);

    await persistCreatedIssueTask({
      tasks: service,
      repo: 'owner/repo',
      issue: {
        number: 42,
        url: 'https://github.com/owner/repo/issues/42',
        title: 'Issue title',
      },
    });

    assert.strictEqual(addCalls.length, 0, 'Should not add when task exists');
    assert.strictEqual(updateCalls.length, 0, 'Should not update (append-only would duplicate)');
    assert.strictEqual(listLinkedCalls.length, 1);
    assert.strictEqual(listLinkedCalls[0].source, 'github');
  });

  it('surfaces persistence errors for caller handling', async () => {
    const failingService: ITaskService = {
      list: async (): Promise<ITaskListResult> => ({
        status: 'ok',
        action: 'list',
        tasks: [],
        mode: 'git-mem',
      }),
      add: async (): Promise<ITaskWriteResult> => {
        throw new Error('git-mem unavailable');
      },
      update: async (): Promise<ITaskWriteResult> => {
        throw new Error('unexpected update call');
      },
      link: async (): Promise<ITaskLinkResult> => {
        throw new Error('unexpected link call');
      },
      unlink: async (): Promise<ITaskLinkResult> => {
        throw new Error('unexpected unlink call');
      },
      listLinked: async (): Promise<ITaskListResult> => ({
        status: 'ok',
        action: 'list',
        tasks: [],
        mode: 'git-mem',
      }),
    };

    await assert.rejects(
      () => persistCreatedIssueTask({
        tasks: failingService,
        repo: 'owner/repo',
        issue: {
          number: 42,
          url: 'https://github.com/owner/repo/issues/42',
          title: 'Issue title',
        },
      }),
      /git-mem unavailable/
    );
  });
});
