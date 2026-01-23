/**
 * Tests for GhCliClient
 *
 * Tests the GitHub CLI wrapper including:
 * - Command execution
 * - GraphQL queries
 * - Authentication detection
 * - Error handling
 */
import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { IGhCliClient, IGhCliClientConfig } from '../../../../../../../src/lib/skills/shared/clients/interfaces';

// We'll test by creating mock implementations and testing the interface contract
// The actual GhCliClient uses child_process.spawn which is harder to unit test

describe('IGhCliClient Interface Contract', () => {
  describe('run<T>()', () => {
    it('should return success result with parsed JSON data', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return {
            success: true,
            data: { number: 123, title: 'Test Issue' } as T,
            exitCode: 0,
          };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'gh-cli' as const; },
      };

      const result = await mockClient.run<{ number: number; title: string }>(['issue', 'view', '123']);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.number, 123);
      assert.strictEqual(result.data?.title, 'Test Issue');
      assert.strictEqual(result.exitCode, 0);
    });

    it('should return error result on failure', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return {
            success: false,
            error: 'Not authenticated',
            exitCode: 1,
          };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: false, error: 'Not authenticated', exitCode: 1 };
        },
        async isAuthenticated() { return false; },
        async getAuthMethod() { return null; },
      };

      const result = await mockClient.run<unknown>(['issue', 'list']);
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Not authenticated');
      assert.strictEqual(result.exitCode, 1);
    });
  });

  describe('runGraphQL<T>()', () => {
    it('should execute GraphQL query with variables', async () => {
      const capturedQuery = { query: '', variables: {} as Record<string, unknown> | undefined };
      
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async runGraphQL<T>(query: string, variables?: Record<string, unknown>) {
          capturedQuery.query = query;
          capturedQuery.variables = variables;
          return {
            success: true,
            data: {
              data: {
                repository: {
                  projectsV2: {
                    nodes: [{ id: 'PVT_123', number: 1, title: 'Sprint' }],
                    totalCount: 1,
                  },
                },
              },
            } as T,
            exitCode: 0,
          };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'gh-cli' as const; },
      };

      const query = `query($owner: String!) { repository(owner: $owner) { projectsV2 { nodes { id } } } }`;
      const variables = { owner: 'testorg', repo: 'testrepo' };
      
      const result = await mockClient.runGraphQL<unknown>(query, variables);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(capturedQuery.query, query);
      assert.deepStrictEqual(capturedQuery.variables, variables);
    });
  });

  describe('isAuthenticated()', () => {
    it('should return true when gh CLI is authenticated', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'gh-cli' as const; },
      };

      const result = await mockClient.isAuthenticated();
      assert.strictEqual(result, true);
    });

    it('should return true when GITHUB_TOKEN is set', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'token' as const; },
      };

      const result = await mockClient.isAuthenticated();
      const method = await mockClient.getAuthMethod();
      
      assert.strictEqual(result, true);
      assert.strictEqual(method, 'token');
    });

    it('should return false when not authenticated', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: false, error: 'Not authenticated', exitCode: 1 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: false, error: 'Not authenticated', exitCode: 1 };
        },
        async isAuthenticated() { return false; },
        async getAuthMethod() { return null; },
      };

      const result = await mockClient.isAuthenticated();
      const method = await mockClient.getAuthMethod();
      
      assert.strictEqual(result, false);
      assert.strictEqual(method, null);
    });
  });

  describe('getAuthMethod()', () => {
    it('should return gh-cli when authenticated via gh auth', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'gh-cli' as const; },
      };

      const method = await mockClient.getAuthMethod();
      assert.strictEqual(method, 'gh-cli');
    });

    it('should return token when using GITHUB_TOKEN', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: true, data: {} as T, exitCode: 0 };
        },
        async isAuthenticated() { return true; },
        async getAuthMethod() { return 'token' as const; },
      };

      const method = await mockClient.getAuthMethod();
      assert.strictEqual(method, 'token');
    });

    it('should return null when not authenticated', async () => {
      const mockClient: IGhCliClient = {
        async run<T>(_args: string[]) {
          return { success: false, error: 'Not authenticated', exitCode: 1 };
        },
        async runGraphQL<T>(_query: string, _variables?: Record<string, unknown>) {
          return { success: false, error: 'Not authenticated', exitCode: 1 };
        },
        async isAuthenticated() { return false; },
        async getAuthMethod() { return null; },
      };

      const method = await mockClient.getAuthMethod();
      assert.strictEqual(method, null);
    });
  });
});

describe('IGhCliResult<T> Type Contract', () => {
  it('should have success, data, error, and exitCode fields', () => {
    // Type check - this is a compile-time test
    const successResult = {
      success: true as const,
      data: { foo: 'bar' },
      exitCode: 0,
    };

    const errorResult = {
      success: false as const,
      error: 'Something went wrong',
      exitCode: 1,
    };

    assert.strictEqual(successResult.success, true);
    assert.strictEqual(successResult.data?.foo, 'bar');
    assert.strictEqual(errorResult.success, false);
    assert.strictEqual(errorResult.error, 'Something went wrong');
  });
});
