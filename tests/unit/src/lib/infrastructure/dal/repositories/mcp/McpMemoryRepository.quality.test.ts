/**
 * Tests for McpMemoryRepository quality stubs.
 *
 * Verifies that MCP correctly throws for unsupported quality operations.
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

describe('McpMemoryRepository - quality', () => {
  let repo: McpMemoryRepository;

  beforeEach(() => {
    const mockConnection = createMockConnection();
    repo = new McpMemoryRepository(mockConnection);
  });

  describe('findByMinConfidence()', () => {
    it('should throw error indicating MCP does not support confidence filtering', async () => {
      await assert.rejects(
        () => repo.findByMinConfidence(['group-1'], 'medium'),
        { message: 'MCP does not support confidence-based filtering. Use Neo4j repository instead.' }
      );
    });
  });

  describe('findConflicts()', () => {
    it('should throw error indicating MCP does not support conflict detection', async () => {
      await assert.rejects(
        () => repo.findConflicts(['group-1']),
        { message: 'MCP does not support conflict detection. Use Neo4j repository instead.' }
      );
    });

    it('should throw error even with topic parameter', async () => {
      await assert.rejects(
        () => repo.findConflicts(['group-1'], 'database'),
        { message: 'MCP does not support conflict detection. Use Neo4j repository instead.' }
      );
    });
  });
});
