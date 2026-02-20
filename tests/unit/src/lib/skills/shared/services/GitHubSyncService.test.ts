/**
 * Tests for GitHubSyncService
 *
 * Tests bidirectional sync between Lisa tasks and GitHub Issues:
 * - Import: GitHub Issues -> Lisa tasks
 * - Export: Lisa tasks -> GitHub Issues
 * - Bidirectional sync with conflict resolution
 * - Status mapping
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 * The groupId in ISyncOptions is kept for interface compatibility but ignored.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createGitHubSyncService,
  lisaStatusToGitHub,
  gitHubStatusToLisa,
} from '../../../../../../../src/lib/skills/shared/services/GitHubSyncService';
import type { IGitHubClient, IGitHubIssue } from '../../../../../../../src/lib/skills/shared/services/GitHubService';
import type {
  ITaskService,
  ITask,
  ITaskListResult,
  ITaskWriteResult,
  ITaskLinkResult,
  ITaskExternalLink,
  ITaskWriteOptions,
} from '../../../../../../../src/lib/skills/shared/services/interfaces';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockIssue(overrides: Partial<IGitHubIssue> = {}): IGitHubIssue {
  return {
    number: 1,
    title: 'Test Issue',
    body: 'Issue description',
    state: 'open',
    labels: [],
    assignees: [],
    url: 'https://github.com/owner/repo/issues/1',
    createdAt: '2026-01-22T10:00:00Z',
    updatedAt: '2026-01-22T10:00:00Z',
    ...overrides,
  };
}

function createMockTask(overrides: Partial<ITask> = {}): ITask {
  return {
    title: 'Test Task',
    status: 'ready',
    repo: 'owner-repo',
    assignee: 'user',
    uuid: 'task-uuid-1',
    created_at: '2026-01-22T09:00:00Z',
    ...overrides,
  };
}

function createMockGitHubClient(overrides: Partial<IGitHubClient> = {}): IGitHubClient {
  return {
    createIssue: async () => ({ number: 100, url: 'https://github.com/owner/repo/issues/100', title: 'New Issue' }),
    listIssues: async () => ({ issues: [], total: 0 }),
    viewIssue: async () => createMockIssue(),
    closeIssue: async ({ number }) => ({ number, state: 'closed' }),
    reopenIssue: async ({ number }) => ({ number, state: 'open' }),
    assignIssue: async ({ number, assignees }) => ({ number, assignees }),
    labelIssue: async ({ number }) => ({ number, labels: [] }),
    listProjects: async () => ({ projects: [], total: 0 }),
    getProject: async () => ({ id: '1', number: 1, title: 'Project', url: '', closed: false }),
    getProjectItems: async () => ({ items: [], total: 0 }),
    getProjectFields: async () => ({ fields: [] }),
    addToProject: async () => ({ itemId: 'item-1' }),
    setProjectField: async ({ itemId, fieldName, value }) => ({ itemId, field: fieldName, value }),
    ...overrides,
  };
}

function createMockTaskService(overrides: Partial<ITaskService> = {}): ITaskService {
  return {
    list: async (): Promise<ITaskListResult> => ({
      status: 'ok',
      action: 'list',
      tasks: [],
      mode: 'git-mem',
    }),
    listLinked: async (): Promise<ITaskListResult> => ({
      status: 'ok',
      action: 'list',
      tasks: [],
      mode: 'git-mem',
    }),
    add: async (title: string): Promise<ITaskWriteResult> => ({
      status: 'ok',
      action: 'add',
      task: { type: 'task', title, status: 'ready', repo: '', assignee: '' },
      mode: 'git-mem',
    }),
    update: async (title: string): Promise<ITaskWriteResult> => ({
      status: 'ok',
      action: 'update',
      task: { type: 'task', title, status: 'ready', repo: '', assignee: '' },
      mode: 'git-mem',
    }),
    link: async (taskUuid: string, externalLink: ITaskExternalLink): Promise<ITaskLinkResult> => ({
      status: 'ok',
      action: 'link',
      task: { title: 'Task', uuid: taskUuid, externalLink },
      mode: 'git-mem',
    }),
    unlink: async (taskUuid: string): Promise<ITaskLinkResult> => ({
      status: 'ok',
      action: 'unlink',
      task: { title: 'Task', uuid: taskUuid },
      mode: 'git-mem',
    }),
    ...overrides,
  };
}

// ============================================================================
// Status Mapping Tests
// ============================================================================

describe('GitHubSyncService', () => {
  describe('Status Mapping', () => {
    describe('lisaStatusToGitHub()', () => {
      it('should map ready to open with no labels', () => {
        const result = lisaStatusToGitHub('ready');
        assert.strictEqual(result.state, 'open');
        assert.deepStrictEqual(result.addLabels, []);
        assert.deepStrictEqual(result.removeLabels, ['in-progress', 'blocked']);
      });

      it('should map todo to open with no labels', () => {
        const result = lisaStatusToGitHub('todo');
        assert.strictEqual(result.state, 'open');
        assert.deepStrictEqual(result.addLabels, []);
      });

      it('should map in-progress to open with in-progress label', () => {
        const result = lisaStatusToGitHub('in-progress');
        assert.strictEqual(result.state, 'open');
        assert.deepStrictEqual(result.addLabels, ['in-progress']);
        assert.deepStrictEqual(result.removeLabels, ['blocked']);
      });

      it('should map blocked to open with blocked label', () => {
        const result = lisaStatusToGitHub('blocked');
        assert.strictEqual(result.state, 'open');
        assert.deepStrictEqual(result.addLabels, ['blocked']);
        assert.deepStrictEqual(result.removeLabels, ['in-progress']);
      });

      it('should map done to closed', () => {
        const result = lisaStatusToGitHub('done');
        assert.strictEqual(result.state, 'closed');
        assert.deepStrictEqual(result.addLabels, []);
        assert.deepStrictEqual(result.removeLabels, ['in-progress', 'blocked']);
      });

      it('should handle various capitalization', () => {
        assert.strictEqual(lisaStatusToGitHub('DONE').state, 'closed');
        assert.strictEqual(lisaStatusToGitHub('In-Progress').addLabels[0], 'in-progress');
      });
    });

    describe('gitHubStatusToLisa()', () => {
      it('should map closed issue to done', () => {
        const issue = createMockIssue({ state: 'closed' });
        assert.strictEqual(gitHubStatusToLisa(issue), 'done');
      });

      it('should map open issue with blocked label to blocked', () => {
        const issue = createMockIssue({ state: 'open', labels: ['blocked', 'bug'] });
        assert.strictEqual(gitHubStatusToLisa(issue), 'blocked');
      });

      it('should map open issue with in-progress label to in-progress', () => {
        const issue = createMockIssue({ state: 'open', labels: ['in-progress'] });
        assert.strictEqual(gitHubStatusToLisa(issue), 'in-progress');
      });

      it('should map open issue with no status labels to ready', () => {
        const issue = createMockIssue({ state: 'open', labels: ['bug', 'enhancement'] });
        assert.strictEqual(gitHubStatusToLisa(issue), 'ready');
      });

      it('should prioritize blocked over in-progress', () => {
        const issue = createMockIssue({ state: 'open', labels: ['blocked', 'in-progress'] });
        assert.strictEqual(gitHubStatusToLisa(issue), 'blocked');
      });
    });
  });

  // ============================================================================
  // Import Tests
  // ============================================================================

  describe('sync() - Import', () => {
    it('should import new GitHub issues as Lisa tasks', async () => {
      const addCalls: Array<{ title: string; options: ITaskWriteOptions }> = [];

      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [
            createMockIssue({ number: 1, title: 'Issue 1' }),
            createMockIssue({ number: 2, title: 'Issue 2' }),
          ],
          total: 2,
        }),
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [],
          mode: 'git-mem',
        }),
        listLinked: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [],
          mode: 'git-mem',
        }),
        add: async (title, options) => {
          addCalls.push({ title, options });
          return {
            status: 'ok',
            action: 'add',
            task: { type: 'task', title, status: 'ready', repo: '', assignee: '' },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
      });

      assert.strictEqual(result.imported, 2);
      assert.strictEqual(result.importedItems.length, 2);
      assert.strictEqual(addCalls.length, 2);
      assert.strictEqual(addCalls[0].title, 'Issue 1');
      assert.strictEqual(addCalls[0].options.externalLink?.source, 'github');
      assert.strictEqual(addCalls[0].options.externalLink?.id, '1');
    });

    it('should skip already-linked issues', async () => {
      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [createMockIssue({ number: 1, title: 'Issue 1' })],
          total: 1,
        }),
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Issue 1',
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
        listLinked: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Issue 1',
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
      });

      assert.strictEqual(result.imported, 0);
      assert.strictEqual(result.skipped, 1);
    });

    it('should update task status from GitHub when status differs', async () => {
      const updateCalls: Array<{ title: string; options: ITaskWriteOptions }> = [];

      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [createMockIssue({ number: 1, title: 'Issue 1', state: 'closed' })],
          total: 1,
        }),
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Issue 1',
              status: 'in-progress', // Different from GitHub (closed -> done)
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
        listLinked: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Issue 1',
              status: 'in-progress',
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
        update: async (title, options) => {
          updateCalls.push({ title, options });
          return {
            status: 'ok',
            action: 'update',
            task: { type: 'task', title, status: options.status || 'ready', repo: '', assignee: '' },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
      });

      assert.strictEqual(result.updated, 1);
      assert.strictEqual(updateCalls.length, 1);
      assert.strictEqual(updateCalls[0].options.status, 'done');
    });

    it('should not modify anything in dry-run mode', async () => {
      let addCalled = false;

      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [createMockIssue({ number: 1, title: 'Issue 1' })],
          total: 1,
        }),
      });

      const tasks = createMockTaskService({
        add: async () => {
          addCalled = true;
          return {
            status: 'ok',
            action: 'add',
            task: { type: 'task', title: 'Issue 1', status: 'ready', repo: '', assignee: '' },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
        dryRun: true,
      });

      assert.strictEqual(result.imported, 1);
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(addCalled, false);
    });
  });

  // ============================================================================
  // Export Tests
  // ============================================================================

  describe('sync() - Export', () => {
    it('should export unlinked Lisa tasks as GitHub issues', async () => {
      const createCalls: Array<{ title: string; labels?: string[] }> = [];
      const linkCalls: Array<{ taskUuid: string; externalLink: ITaskExternalLink }> = [];

      const github = createMockGitHubClient({
        listIssues: async () => ({ issues: [], total: 0 }),
        createIssue: async ({ title, labels }) => {
          createCalls.push({ title, labels });
          return { number: 100, url: 'https://github.com/owner/repo/issues/100', title };
        },
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({ title: 'Task 1', uuid: 'uuid-1' }),
            createMockTask({ title: 'Task 2', uuid: 'uuid-2' }),
          ],
          mode: 'git-mem',
        }),
        link: async (taskUuid, externalLink) => {
          linkCalls.push({ taskUuid, externalLink });
          return {
            status: 'ok',
            action: 'link',
            task: { title: 'Task', uuid: taskUuid, externalLink },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'export',
        groupId: 'test-group',
      });

      assert.strictEqual(result.exported, 2);
      assert.strictEqual(createCalls.length, 2);
      assert.strictEqual(linkCalls.length, 2);
      assert.strictEqual(linkCalls[0].externalLink.source, 'github');
      assert.strictEqual(linkCalls[0].externalLink.id, '100');
    });

    it('should close GitHub issue when Lisa task is done', async () => {
      let closeCalled = false;

      const github = createMockGitHubClient({
        listIssues: async () => ({ issues: [], total: 0 }),
        createIssue: async () => ({ number: 100, url: 'https://github.com/owner/repo/issues/100', title: 'Task 1' }),
        closeIssue: async () => {
          closeCalled = true;
          return { number: 100, state: 'closed' };
        },
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [createMockTask({ title: 'Task 1', status: 'done', uuid: 'uuid-1' })],
          mode: 'git-mem',
        }),
      });

      const syncService = createGitHubSyncService({ github, tasks });
      await syncService.sync({
        repo: 'owner/repo',
        direction: 'export',
        groupId: 'test-group',
      });

      assert.strictEqual(closeCalled, true);
    });

    it('should add in-progress label when Lisa task is in-progress', async () => {
      const createCalls: Array<{ labels?: string[] }> = [];

      const github = createMockGitHubClient({
        listIssues: async () => ({ issues: [], total: 0 }),
        createIssue: async ({ labels }) => {
          createCalls.push({ labels });
          return { number: 100, url: 'https://github.com/owner/repo/issues/100', title: 'Task 1' };
        },
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [createMockTask({ title: 'Task 1', status: 'in-progress', uuid: 'uuid-1' })],
          mode: 'git-mem',
        }),
      });

      const syncService = createGitHubSyncService({ github, tasks });
      await syncService.sync({
        repo: 'owner/repo',
        direction: 'export',
        groupId: 'test-group',
      });

      assert.strictEqual(createCalls.length, 1);
      assert.ok(createCalls[0].labels?.includes('in-progress'));
    });
  });

  // ============================================================================
  // Bidirectional Sync Tests
  // ============================================================================

  describe('sync() - Bidirectional', () => {
    it('should import, export, and update in bidirectional mode', async () => {
      let addCalls = 0;
      let createCalls = 0;

      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [
            createMockIssue({ number: 1, title: 'Existing Issue', updatedAt: '2026-01-22T12:00:00Z' }),
          ],
          total: 1,
        }),
        createIssue: async () => {
          createCalls++;
          return { number: 100, url: 'https://github.com/owner/repo/issues/100', title: 'New Task' };
        },
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({ title: 'New Task', uuid: 'uuid-new' }), // No external link - will be exported
          ],
          mode: 'git-mem',
        }),
        listLinked: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [],
          mode: 'git-mem',
        }),
        add: async () => {
          addCalls++;
          return {
            status: 'ok',
            action: 'add',
            task: { type: 'task', title: 'Existing Issue', status: 'ready', repo: '', assignee: '' },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'bidirectional',
        groupId: 'test-group',
      });

      assert.strictEqual(result.imported, 1);
      assert.strictEqual(result.exported, 1);
      assert.strictEqual(addCalls, 1);
      assert.strictEqual(createCalls, 1);
    });

    it('should detect and resolve conflicts using last-write-wins', async () => {
      const updateCalls: Array<{ title: string; status?: string }> = [];

      // GitHub issue updated more recently
      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [
            createMockIssue({
              number: 1,
              title: 'Conflicting Issue',
              state: 'closed',
              updatedAt: '2026-01-22T12:00:00Z', // More recent
            }),
          ],
          total: 1,
        }),
      });

      const tasks = createMockTaskService({
        list: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Conflicting Issue',
              status: 'in-progress', // Different from GitHub
              uuid: 'uuid-1',
              created_at: '2026-01-22T10:00:00Z', // Older
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
        listLinked: async () => ({
          status: 'ok',
          action: 'list',
          tasks: [
            createMockTask({
              title: 'Conflicting Issue',
              status: 'in-progress',
              uuid: 'uuid-1',
              created_at: '2026-01-22T10:00:00Z',
              externalLink: { source: 'github', id: '1', url: 'https://github.com/owner/repo/issues/1' },
            }),
          ],
          mode: 'git-mem',
        }),
        update: async (title, options) => {
          updateCalls.push({ title, status: options.status });
          return {
            status: 'ok',
            action: 'update',
            task: { type: 'task', title, status: options.status || 'ready', repo: '', assignee: '' },
            mode: 'git-mem',
          };
        },
      });

      const syncService = createGitHubSyncService({ github, tasks });
      const result = await syncService.sync({
        repo: 'owner/repo',
        direction: 'bidirectional',
        groupId: 'test-group',
      });

      assert.strictEqual(result.conflicts.length, 1);
      assert.strictEqual(result.conflicts[0].resolution, 'remote'); // GitHub wins
      assert.strictEqual(result.updated, 1);
      assert.strictEqual(updateCalls[0].status, 'done'); // Updated to GitHub's state
    });
  });

  // ============================================================================
  // Preview Sync Tests
  // ============================================================================

  describe('previewSync()', () => {
    it('should return same results as dry-run sync', async () => {
      const github = createMockGitHubClient({
        listIssues: async () => ({
          issues: [createMockIssue({ number: 1, title: 'Issue 1' })],
          total: 1,
        }),
      });

      const tasks = createMockTaskService();

      const syncService = createGitHubSyncService({ github, tasks });
      const previewResult = await syncService.previewSync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
      });

      assert.strictEqual(previewResult.dryRun, true);
      assert.strictEqual(previewResult.imported, 1);
    });
  });

  // ============================================================================
  // Label Filtering Tests
  // ============================================================================

  describe('Label Filtering', () => {
    it('should pass labels filter to GitHub listIssues', async () => {
      let capturedLabels: string[] | undefined;

      const github = createMockGitHubClient({
        listIssues: async ({ labels }) => {
          capturedLabels = labels;
          return { issues: [], total: 0 };
        },
      });

      const tasks = createMockTaskService();

      const syncService = createGitHubSyncService({ github, tasks });
      await syncService.sync({
        repo: 'owner/repo',
        direction: 'import',
        groupId: 'test-group',
        labels: ['task', 'lisa'],
      });

      assert.deepStrictEqual(capturedLabels, ['task', 'lisa']);
    });
  });
});
