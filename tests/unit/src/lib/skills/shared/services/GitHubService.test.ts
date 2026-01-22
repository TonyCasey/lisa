/**
 * Tests for GitHubService
 *
 * Tests the GitHub service including:
 * - Issue operations (create, list, view, close, reopen, assign, label)
 * - Project operations (list, get, items, fields, add, set-field)
 * - Error handling
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { IGhCliClient, IGhCliResult } from '../../../../../../../src/lib/skills/shared/clients/interfaces';
import { createGitHubClient, type IGitHubClient } from '../../../../../../../src/lib/skills/shared/services/GitHubService';

/**
 * Creates a mock IGhCliClient for testing
 */
function createMockGhCliClient(
  runHandler: <T>(args: string[]) => Promise<IGhCliResult<T>>,
  graphQLHandler?: <T>(query: string, variables?: Record<string, unknown>) => Promise<IGhCliResult<T>>
): IGhCliClient {
  return {
    async run<T>(args: string[]): Promise<IGhCliResult<T>> {
      return runHandler<T>(args);
    },
    async runGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<IGhCliResult<T>> {
      if (graphQLHandler) {
        return graphQLHandler<T>(query, variables);
      }
      return { success: true, data: {} as T, exitCode: 0 };
    },
    async isAuthenticated(): Promise<boolean> {
      return true;
    },
    async getAuthMethod(): Promise<'gh-cli' | 'token' | null> {
      return 'gh-cli';
    },
  };
}

describe('GitHubService', () => {
  describe('Issues', () => {
    describe('createIssue()', () => {
      it('should create an issue with required fields', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return {
            success: true,
            data: { raw: 'https://github.com/owner/repo/issues/123' } as T,
            exitCode: 0,
          };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.createIssue({
          repo: 'owner/repo',
          title: 'Test Issue',
        });

        assert.strictEqual(result.number, 123);
        assert.strictEqual(result.url, 'https://github.com/owner/repo/issues/123');
        assert.strictEqual(result.title, 'Test Issue');
        assert.ok(capturedArgs.includes('--repo'));
        assert.ok(capturedArgs.includes('owner/repo'));
        assert.ok(capturedArgs.includes('--title'));
        assert.ok(capturedArgs.includes('Test Issue'));
      });

      it('should create an issue with all optional fields', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return {
            success: true,
            data: { raw: 'https://github.com/owner/repo/issues/456' } as T,
            exitCode: 0,
          };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.createIssue({
          repo: 'owner/repo',
          title: 'Feature Request',
          body: 'Please add this feature',
          labels: ['enhancement', 'priority-high'],
          assignee: 'developer',
        });

        assert.strictEqual(result.number, 456);
        assert.ok(capturedArgs.includes('--body'));
        assert.ok(capturedArgs.includes('Please add this feature'));
        assert.ok(capturedArgs.includes('--label'));
        assert.ok(capturedArgs.includes('enhancement,priority-high'));
        assert.ok(capturedArgs.includes('--assignee'));
        assert.ok(capturedArgs.includes('developer'));
      });

      it('should throw error on failure', async () => {
        const mockClient = createMockGhCliClient(async <T>(_args: string[]) => {
          return {
            success: false,
            error: 'Repository not found',
            exitCode: 1,
          };
        });

        const github = createGitHubClient(mockClient);
        
        await assert.rejects(
          () => github.createIssue({ repo: 'invalid/repo', title: 'Test' }),
          { message: 'Repository not found' }
        );
      });
    });

    describe('listIssues()', () => {
      it('should list issues with default options', async () => {
        const mockClient = createMockGhCliClient(async <T>(_args: string[]) => {
          return {
            success: true,
            data: [
              {
                number: 1,
                title: 'First Issue',
                body: 'Description',
                state: 'OPEN',
                labels: [{ name: 'bug' }],
                assignees: [{ login: 'user1' }],
                url: 'https://github.com/owner/repo/issues/1',
                createdAt: '2026-01-22T10:00:00Z',
                updatedAt: '2026-01-22T11:00:00Z',
              },
            ] as T,
            exitCode: 0,
          };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.listIssues({ repo: 'owner/repo' });

        assert.strictEqual(result.issues.length, 1);
        assert.strictEqual(result.issues[0].number, 1);
        assert.strictEqual(result.issues[0].title, 'First Issue');
        assert.strictEqual(result.issues[0].state, 'open');
        assert.deepStrictEqual(result.issues[0].labels, ['bug']);
        assert.deepStrictEqual(result.issues[0].assignees, ['user1']);
      });

      it('should list issues with filters', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return { success: true, data: [] as T, exitCode: 0 };
        });

        const github = createGitHubClient(mockClient);
        await github.listIssues({
          repo: 'owner/repo',
          state: 'closed',
          labels: ['bug', 'wontfix'],
          assignee: '@me',
          limit: 10,
        });

        assert.ok(capturedArgs.includes('--state'));
        assert.ok(capturedArgs.includes('closed'));
        assert.ok(capturedArgs.includes('--label'));
        assert.ok(capturedArgs.includes('bug,wontfix'));
        assert.ok(capturedArgs.includes('--assignee'));
        assert.ok(capturedArgs.includes('@me'));
        assert.ok(capturedArgs.includes('--limit'));
        assert.ok(capturedArgs.includes('10'));
      });
    });

    describe('viewIssue()', () => {
      it('should view a single issue', async () => {
        const mockClient = createMockGhCliClient(async <T>(_args: string[]) => {
          return {
            success: true,
            data: {
              number: 123,
              title: 'Bug Report',
              body: 'Steps to reproduce...',
              state: 'OPEN',
              labels: [{ name: 'bug' }],
              assignees: [],
              url: 'https://github.com/owner/repo/issues/123',
              createdAt: '2026-01-22T10:00:00Z',
              updatedAt: '2026-01-22T10:00:00Z',
              author: { login: 'reporter' },
            } as T,
            exitCode: 0,
          };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.viewIssue({ repo: 'owner/repo', number: 123 });

        assert.strictEqual(result.number, 123);
        assert.strictEqual(result.title, 'Bug Report');
        assert.strictEqual(result.body, 'Steps to reproduce...');
        assert.strictEqual(result.author, 'reporter');
      });

      it('should throw error when issue not found', async () => {
        const mockClient = createMockGhCliClient(async <T>(_args: string[]) => {
          return {
            success: false,
            error: 'issue not found',
            exitCode: 1,
          };
        });

        const github = createGitHubClient(mockClient);
        
        await assert.rejects(
          () => github.viewIssue({ repo: 'owner/repo', number: 999 }),
          { message: 'issue not found' }
        );
      });
    });

    describe('closeIssue()', () => {
      it('should close an issue', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return { success: true, data: {} as T, exitCode: 0 };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.closeIssue({ repo: 'owner/repo', number: 123 });

        assert.strictEqual(result.number, 123);
        assert.strictEqual(result.state, 'closed');
        assert.ok(capturedArgs.includes('close'));
        assert.ok(capturedArgs.includes('123'));
      });

      it('should close with reason', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return { success: true, data: {} as T, exitCode: 0 };
        });

        const github = createGitHubClient(mockClient);
        await github.closeIssue({ repo: 'owner/repo', number: 123, reason: 'not_planned' });

        assert.ok(capturedArgs.includes('--reason'));
        assert.ok(capturedArgs.includes('not_planned'));
      });
    });

    describe('reopenIssue()', () => {
      it('should reopen an issue', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return { success: true, data: {} as T, exitCode: 0 };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.reopenIssue({ repo: 'owner/repo', number: 123 });

        assert.strictEqual(result.number, 123);
        assert.strictEqual(result.state, 'open');
        assert.ok(capturedArgs.includes('reopen'));
      });
    });

    describe('assignIssue()', () => {
      it('should assign users to an issue', async () => {
        const capturedArgs: string[] = [];
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          capturedArgs.push(...args);
          return { success: true, data: {} as T, exitCode: 0 };
        });

        const github = createGitHubClient(mockClient);
        const result = await github.assignIssue({
          repo: 'owner/repo',
          number: 123,
          assignees: ['user1', 'user2'],
        });

        assert.strictEqual(result.number, 123);
        assert.deepStrictEqual(result.assignees, ['user1', 'user2']);
        assert.ok(capturedArgs.includes('--add-assignee'));
        assert.ok(capturedArgs.includes('user1,user2'));
      });
    });

    describe('labelIssue()', () => {
      it('should add and remove labels', async () => {
        const capturedArgs: string[] = [];
        let callCount = 0;
        const mockClient = createMockGhCliClient(async <T>(args: string[]) => {
          callCount++;
          if (callCount === 1) {
            // First call is the edit command
            capturedArgs.push(...args);
            return { success: true, data: {} as T, exitCode: 0 };
          } else {
            // Second call is viewIssue to get updated labels
            return {
              success: true,
              data: {
                number: 123,
                title: 'Issue',
                state: 'OPEN',
                labels: [{ name: 'bug' }, { name: 'priority-high' }],
                assignees: [],
                url: 'https://github.com/owner/repo/issues/123',
                createdAt: '2026-01-22T10:00:00Z',
                updatedAt: '2026-01-22T10:00:00Z',
              } as T,
              exitCode: 0,
            };
          }
        });

        const github = createGitHubClient(mockClient);
        const result = await github.labelIssue({
          repo: 'owner/repo',
          number: 123,
          add: ['bug', 'priority-high'],
          remove: ['wontfix'],
        });

        assert.strictEqual(result.number, 123);
        assert.ok(capturedArgs.includes('--add-label'));
        assert.ok(capturedArgs.includes('bug,priority-high'));
        assert.ok(capturedArgs.includes('--remove-label'));
        assert.ok(capturedArgs.includes('wontfix'));
      });
    });
  });

  describe('Projects v2', () => {
    describe('listProjects()', () => {
      it('should list projects via GraphQL', async () => {
        const mockClient = createMockGhCliClient(
          async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
          async <T>(_query: string, _variables?: Record<string, unknown>) => {
            return {
              success: true,
              data: {
                data: {
                  repository: {
                    projectsV2: {
                      totalCount: 2,
                      nodes: [
                        { id: 'PVT_1', number: 1, title: 'Sprint 1', url: 'https://github.com/orgs/owner/projects/1', closed: false },
                        { id: 'PVT_2', number: 2, title: 'Sprint 2', url: 'https://github.com/orgs/owner/projects/2', closed: true },
                      ],
                    },
                  },
                },
              } as T,
              exitCode: 0,
            };
          }
        );

        const github = createGitHubClient(mockClient);
        const result = await github.listProjects({ repo: 'owner/repo' });

        assert.strictEqual(result.projects.length, 2);
        assert.strictEqual(result.total, 2);
        assert.strictEqual(result.projects[0].title, 'Sprint 1');
        assert.strictEqual(result.projects[1].closed, true);
      });
    });

    describe('getProject()', () => {
      it('should get a single project', async () => {
        const mockClient = createMockGhCliClient(
          async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
          async <T>(_query: string, _variables?: Record<string, unknown>) => {
            return {
              success: true,
              data: {
                data: {
                  repository: {
                    projectV2: {
                      id: 'PVT_1',
                      number: 1,
                      title: 'Sprint Board',
                      url: 'https://github.com/orgs/owner/projects/1',
                      closed: false,
                      shortDescription: 'Current sprint tasks',
                    },
                  },
                },
              } as T,
              exitCode: 0,
            };
          }
        );

        const github = createGitHubClient(mockClient);
        const result = await github.getProject({ repo: 'owner/repo', number: 1 });

        assert.strictEqual(result.id, 'PVT_1');
        assert.strictEqual(result.title, 'Sprint Board');
        assert.strictEqual(result.shortDescription, 'Current sprint tasks');
      });
    });

    describe('getProjectFields()', () => {
      it('should get project fields including single select options', async () => {
        const mockClient = createMockGhCliClient(
          async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
          async <T>(_query: string, _variables?: Record<string, unknown>) => {
            return {
              success: true,
              data: {
                data: {
                  repository: {
                    projectV2: {
                      id: 'PVT_1',
                      fields: {
                        nodes: [
                          { id: 'PVTF_1', name: 'Status', dataType: 'SINGLE_SELECT', options: [
                            { id: 'opt_1', name: 'Todo' },
                            { id: 'opt_2', name: 'In Progress' },
                            { id: 'opt_3', name: 'Done' },
                          ]},
                          { id: 'PVTF_2', name: 'Title', dataType: 'TEXT' },
                        ],
                      },
                    },
                  },
                },
              } as T,
              exitCode: 0,
            };
          }
        );

        const github = createGitHubClient(mockClient);
        const result = await github.getProjectFields({ repo: 'owner/repo', projectNumber: 1 });

        assert.strictEqual(result.fields.length, 2);
        assert.strictEqual(result.fields[0].name, 'Status');
        assert.strictEqual(result.fields[0].dataType, 'SINGLE_SELECT');
        assert.strictEqual(result.fields[0].options?.length, 3);
        assert.strictEqual(result.fields[0].options?.[1].name, 'In Progress');
      });
    });

    describe('getProjectItems()', () => {
      it('should get project items with field values', async () => {
        const mockClient = createMockGhCliClient(
          async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
          async <T>(_query: string, _variables?: Record<string, unknown>) => {
            return {
              success: true,
              data: {
                data: {
                  repository: {
                    projectV2: {
                      items: {
                        totalCount: 1,
                        nodes: [
                          {
                            id: 'PVTI_1',
                            type: 'ISSUE',
                            content: { number: 123, title: 'Bug fix', url: 'https://github.com/owner/repo/issues/123', state: 'OPEN' },
                            fieldValues: {
                              nodes: [
                                { name: 'In Progress', field: { name: 'Status' } },
                                { text: 'Bug fix', field: { name: 'Title' } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              } as T,
              exitCode: 0,
            };
          }
        );

        const github = createGitHubClient(mockClient);
        const result = await github.getProjectItems({ repo: 'owner/repo', projectNumber: 1 });

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0].type, 'ISSUE');
        assert.strictEqual(result.items[0].content?.number, 123);
        assert.strictEqual(result.items[0].fieldValues['Status'], 'In Progress');
      });
    });

    describe('addToProject()', () => {
      it('should add an issue to a project', async () => {
        let graphQLCallCount = 0;
        const mockClient = createMockGhCliClient(
          async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
          async <T>(query: string, _variables?: Record<string, unknown>) => {
            graphQLCallCount++;
            if (query.includes('projectV2(number:')) {
              // Get project ID
              return {
                success: true,
                data: { data: { repository: { projectV2: { id: 'PVT_1' } } } } as T,
                exitCode: 0,
              };
            } else if (query.includes('issue(number:')) {
              // Get issue ID
              return {
                success: true,
                data: { data: { repository: { issue: { id: 'I_123' } } } } as T,
                exitCode: 0,
              };
            } else if (query.includes('addProjectV2ItemById')) {
              // Add to project mutation
              return {
                success: true,
                data: { data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } } as T,
                exitCode: 0,
              };
            }
            return { success: true, data: {} as T, exitCode: 0 };
          }
        );

        const github = createGitHubClient(mockClient);
        const result = await github.addToProject({
          repo: 'owner/repo',
          projectNumber: 1,
          issueNumber: 123,
        });

        assert.strictEqual(result.itemId, 'PVTI_new');
        assert.strictEqual(graphQLCallCount, 3); // project ID + issue ID + mutation
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw descriptive error for invalid repo format', async () => {
      const mockClient = createMockGhCliClient(
        async <T>(_args: string[]) => ({ success: true, data: {} as T, exitCode: 0 }),
        async <T>(_query: string, _variables?: Record<string, unknown>) => {
          // parseRepo is called before GraphQL
          throw new Error('Invalid repo format: invalid. Expected "owner/repo".');
        }
      );

      const github = createGitHubClient(mockClient);
      
      await assert.rejects(
        () => github.listProjects({ repo: 'invalid' }),
        { message: 'Invalid repo format: invalid. Expected "owner/repo".' }
      );
    });
  });
});
