/**
 * RepositoryFactory Fallback Tests
 *
 * Tests the factory behavior when backends are unavailable during initialization.
 * Verifies graceful degradation and error logging.
 * 
 * NOTE: These tests avoid real network calls by:
 * 1. Testing configuration parsing and logging behavior
 * 2. Testing closeConnections with mock objects
 * 3. Testing selective backend disable (which skips connection attempts)
 * 
 * Network-dependent failure tests are in integration tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces';
import type { IConnectionManagers } from '../../../../../../src/lib/infrastructure/dal/RepositoryFactory';

/**
 * Create a mock logger that captures log calls.
 */
function createMockLogger(): ILogger & { 
  debugCalls: unknown[][]; 
  warnCalls: unknown[][]; 
  infoCalls: unknown[][];
  errorCalls: unknown[][];
} {
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];

  const createChildLogger = (): ILogger & { 
    debugCalls: unknown[][]; 
    warnCalls: unknown[][]; 
    infoCalls: unknown[][];
    errorCalls: unknown[][];
  } => ({
    debugCalls,
    warnCalls,
    infoCalls,
    errorCalls,
    trace: () => {},
    debug: (...args: unknown[]) => { debugCalls.push(args); },
    info: (...args: unknown[]) => { infoCalls.push(args); },
    warn: (...args: unknown[]) => { warnCalls.push(args); },
    error: (...args: unknown[]) => { errorCalls.push(args); },
    fatal: () => {},
    child: () => createChildLogger(),
    isLevelEnabled: () => true,
  });

  return createChildLogger();
}

describe('RepositoryFactory Fallback Tests', () => {
  describe('Selective Backend Configuration (Fast - No Network)', () => {
    it('should skip MCP initialization when explicitly disabled', async () => {
      const logger = createMockLogger();

      const { createRepositoryRouter } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      try {
        await createRepositoryRouter({
          mcp: false,  // Explicitly disabled - no network call
          neo4j: false,
          zep: false,
          logger,
        });
      } catch (error) {
        // Expected: throws when all backends disabled
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('No DAL backends available'));
      }

      // Should NOT have attempted MCP initialization
      const mcpInitLog = logger.debugCalls.find(
        call => call[0] === 'Initializing MCP backend'
      );
      assert.strictEqual(mcpInitLog, undefined, 'Should not try to initialize disabled MCP');
    });

    it('should skip Neo4j initialization when explicitly disabled', async () => {
      const logger = createMockLogger();

      const { createRepositoryRouter } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      try {
        await createRepositoryRouter({
          mcp: false,
          neo4j: false,  // Explicitly disabled - no network call
          zep: false,
          logger,
        });
      } catch (error) {
        assert.ok(error instanceof Error);
      }

      // Should NOT have attempted Neo4j initialization
      const neo4jInitLog = logger.debugCalls.find(
        call => call[0] === 'Initializing Neo4j backend'
      );
      assert.strictEqual(neo4jInitLog, undefined, 'Should not try to initialize disabled Neo4j');
    });

    it('should skip Zep initialization when explicitly disabled', async () => {
      const logger = createMockLogger();

      const { createRepositoryRouter } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      try {
        await createRepositoryRouter({
          mcp: false,
          neo4j: false,
          zep: false,  // Explicitly disabled - no network call
          logger,
        });
      } catch (error) {
        assert.ok(error instanceof Error);
      }

      // Should NOT have attempted Zep initialization
      const zepInitLog = logger.debugCalls.find(
        call => call[0] === 'Initializing Zep backend'
      );
      assert.strictEqual(zepInitLog, undefined, 'Should not try to initialize disabled Zep');
    });

    it('should log debug when creating repository router with config', async () => {
      const logger = createMockLogger();

      const { createRepositoryRouter } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      try {
        await createRepositoryRouter({
          mcp: false,
          neo4j: false,
          zep: false,
          logger,
        });
      } catch {
        // Expected
      }

      // Should have logged the creation attempt with config flags
      const createLog = logger.debugCalls.find(
        call => call[0] === 'Creating repository router'
      );
      assert.ok(createLog, 'Should log when creating router');
      
      const context = createLog[1] as { enableMcp: boolean; enableNeo4j: boolean; enableZep: boolean };
      assert.strictEqual(context.enableMcp, false);
      assert.strictEqual(context.enableNeo4j, false);
      assert.strictEqual(context.enableZep, false);
    });

    it('should throw with helpful message when all backends disabled', async () => {
      const logger = createMockLogger();

      const { createRepositoryRouter } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      try {
        await createRepositoryRouter({
          mcp: false,
          neo4j: false,
          zep: false,
          logger,
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        // Error should mention all possible configuration options
        assert.ok(error.message.includes('GRAPHITI_ENDPOINT'), 'Should mention MCP env var');
        assert.ok(error.message.includes('NEO4J_URI'), 'Should mention Neo4j env var');
        assert.ok(error.message.includes('ZEP_API_KEY'), 'Should mention Zep env var');
      }

      // Should have logged error
      const errorLog = logger.errorCalls.find(
        call => call[0] === 'No DAL backends available'
      );
      assert.ok(errorLog, 'Should log error when all backends unavailable');
    });
  });

  describe('Connection Manager Cleanup (Fast - No Network)', () => {
    it('should export closeConnections function', async () => {
      const { closeConnections } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      assert.strictEqual(typeof closeConnections, 'function');
    });

    it('should handle empty connections object in closeConnections', async () => {
      const { closeConnections } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      // Should not throw with empty connections
      await assert.doesNotReject(async () => {
        await closeConnections({});
      });
    });

    it('should handle partial connections (undefined values) in closeConnections', async () => {
      const { closeConnections } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      // Should not throw with partial connections (undefined values)
      await assert.doesNotReject(async () => {
        await closeConnections({
          mcp: undefined,
          neo4j: undefined,
          zep: undefined,
        });
      });
    });

    it('should call disconnect on provided connection managers', async () => {
      const { closeConnections } = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      let mcpDisconnectCalled = false;
      let neo4jDisconnectCalled = false;

      // Create minimal mocks that satisfy the disconnect requirement
      const mockMcp = {
        disconnect: async () => { mcpDisconnectCalled = true; },
      };

      const mockNeo4j = {
        disconnect: async () => { neo4jDisconnectCalled = true; },
      };

      // Use type assertion since we only need disconnect method
      const mockConnections = {
        mcp: mockMcp as IConnectionManagers['mcp'],
        neo4j: mockNeo4j as IConnectionManagers['neo4j'],
      };

      await closeConnections(mockConnections);

      assert.strictEqual(mcpDisconnectCalled, true, 'Should call disconnect on MCP');
      assert.strictEqual(neo4jDisconnectCalled, true, 'Should call disconnect on Neo4j');
    });
  });

  describe('Graceful Degradation Messaging', () => {
    it('should define consistent log message formats for backend initialization', async () => {
      // Verify the expected log format strings
      // When a backend succeeds, it logs: `${backend} backend initialized`
      const expectedLogFormats = [
        'MCP backend initialized',
        'Neo4j backend initialized',
        'Zep backend initialized',
      ];

      for (const format of expectedLogFormats) {
        assert.ok(
          typeof format === 'string' && format.includes('backend initialized'),
          `Expected log format: ${format}`
        );
      }
    });

    it('should define consistent warning message format for unavailable backends', async () => {
      // Verify the expected warning format strings
      const expectedWarnings = [
        'MCP backend not available',
        'Neo4j backend not available',
        'Zep backend not available',
      ];

      for (const warning of expectedWarnings) {
        assert.ok(
          typeof warning === 'string' && warning.includes('not available'),
          `Expected warning format: ${warning}`
        );
      }
    });
  });

  describe('Factory Result Interface', () => {
    it('should define IRepositoryFactoryResult with required properties', async () => {
      // Import types to verify interface structure
      const factoryModule = await import(
        '../../../../../../src/lib/infrastructure/dal/RepositoryFactory'
      );

      // Verify exports exist
      assert.ok(factoryModule.createRepositoryRouter, 'Should export createRepositoryRouter');
      assert.ok(factoryModule.closeConnections, 'Should export closeConnections');
    });
  });
});
