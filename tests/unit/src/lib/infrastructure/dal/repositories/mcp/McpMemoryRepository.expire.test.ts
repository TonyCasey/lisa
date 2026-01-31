/**
 * Tests for McpMemoryRepository expiration stubs.
 *
 * Verifies that MCP correctly throws for unsupported expiration operations.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { McpMemoryRepository } from '../../../../../../../../src/lib/infrastructure/dal/repositories/mcp/McpMemoryRepository';
import type { McpConnectionManager } from '../../../../../../../../src/lib/infrastructure/dal/connections/McpConnectionManager';

function createMockConnection(): McpConnectionManager {
  return {
    call: mock.fn(async () => ({})),
    connect: mock.fn(async () => undefined),
    disconnect: mock.fn(async () => undefined),
    isConnected: mock.fn(async () => true),
    getConfig: mock.fn(() => ({})),
  } as unknown as McpConnectionManager;
}

describe('McpMemoryRepository - expire', () => {
  let repo: McpMemoryRepository;

  beforeEach(() => {
    const mockConnection = createMockConnection();
    repo = new McpMemoryRepository(mockConnection);
  });

  describe('expire()', () => {
    it('should throw error indicating MCP does not support expiration', async () => {
      await assert.rejects(
        () => repo.expire('group-1', 'uuid-abc'),
        { message: 'MCP does not support direct expiration. Use Neo4j repository instead.' }
      );
    });
  });

  describe('expireByFilter()', () => {
    it('should throw error indicating MCP does not support expiration', async () => {
      await assert.rejects(
        () => repo.expireByFilter('group-1', { lifecycle: 'session' }),
        { message: 'MCP does not support direct expiration. Use Neo4j repository instead.' }
      );
    });
  });
});
