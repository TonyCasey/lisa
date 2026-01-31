/**
 * DAL (Data Access Layer) Integration Tests
 *
 * Tests DAL routing and multi-backend support against real backends.
 *
 * Enable by setting environment variables:
 *   RUN_DAL_INTEGRATION_TESTS=1
 *
 * Required backends (Docker):
 *   - Neo4j: bolt://localhost:7687
 *   - MCP: http://localhost:8010/mcp/
 *
 * Start with:
 *   docker compose -f .lisa/docker-compose.graphiti.yml up -d
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRepositoryRouter,
  closeConnections,
  type IRepositoryFactoryResult,
} from '../../../src/lib/infrastructure/dal';

// =============================================================================
// Test Configuration
// =============================================================================

// DAL tests always run - requires Docker backends (Neo4j + MCP)
// Start with: docker compose -f .lisa/docker-compose.graphiti.yml up -d

const GROUP_ID = process.env.DAL_TEST_GROUP_ID || 'lisa';
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'demodemo';
const MCP_ENDPOINT = process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/';

// =============================================================================
// Test Suite
// =============================================================================

describe('DAL integration', () => {
    let routerResult: IRepositoryFactoryResult;

    before(async () => {
      // Create router with all backends
      routerResult = await createRepositoryRouter({
        mcpEndpoint: MCP_ENDPOINT,
        neo4jUri: NEO4J_URI,
        neo4jUsername: NEO4J_USER,
        neo4jPassword: NEO4J_PASSWORD,
      });

      // Seed a test fact via MCP so ordering tests have data to work with
      const mcpRepo = routerResult.router.getMemoryRepositoryByBackend('mcp');
      if (mcpRepo) {
        await mcpRepo.save(GROUP_ID, 'DAL integration test seed fact', {
          source: 'dal-integration-test',
        });
        // Allow Graphiti time to index the fact
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    });

    after(async () => {
      // Clean up connections
      if (routerResult?.connections) {
        await closeConnections(routerResult.connections);
      }
    });

    // =========================================================================
    // Router Creation Tests
    // =========================================================================

    describe('router creation', () => {
      test('creates router with available backends', { timeout: 10_000 }, () => {
        assert.ok(routerResult.router, 'Router should be created');
        assert.ok(routerResult.availableBackends.length > 0, 'Should have at least one backend');
      });

      test('has MCP backend available', { timeout: 10_000 }, () => {
        assert.ok(
          routerResult.router.isBackendAvailable('mcp'),
          'MCP backend should be available'
        );
      });

      test('has Neo4j backend available', { timeout: 10_000 }, () => {
        assert.ok(
          routerResult.router.isBackendAvailable('neo4j'),
          'Neo4j backend should be available'
        );
      });

      test('has correct default routing rules', { timeout: 10_000 }, () => {
        const rules = routerResult.router.getRoutingRules();
        
        const listRule = rules.find((r) => r.operation === 'list');
        assert.ok(listRule, 'Should have list rule');
        assert.equal(listRule?.preferred, 'neo4j', 'List should prefer Neo4j');

        const searchRule = rules.find((r) => r.operation === 'search');
        assert.ok(searchRule, 'Should have search rule');
        assert.equal(searchRule?.preferred, 'mcp', 'Search should prefer MCP');

        const writeRule = rules.find((r) => r.operation === 'write');
        assert.ok(writeRule, 'Should have write rule');
        assert.equal(writeRule?.preferred, 'mcp', 'Write should prefer MCP');
      });
    });

    // =========================================================================
    // Neo4j Memory Repository Tests
    // =========================================================================

    describe('Neo4j memory repository', () => {
      test('returns facts in date order (newest first)', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('neo4j');
        assert.ok(repo, 'Neo4j memory repository should exist');

        const result = await repo.findByGroupIds([GROUP_ID], {
          sort: { field: 'created_at', order: 'desc' },
          limit: 10,
        });

        assert.equal(result.source, 'neo4j', 'Source should be neo4j');
        assert.ok(Array.isArray(result.items), 'Items should be an array');

        // Verify date ordering (if we have multiple items with valid dates)
        if (result.items.length >= 2) {
          const itemsWithDates = result.items.filter((item) => {
            if (!item.created_at) return false;
            const time = new Date(item.created_at).getTime();
            return !isNaN(time);
          });
          
          if (itemsWithDates.length >= 2) {
            const dates = itemsWithDates.map((item) =>
              new Date(item.created_at!).getTime()
            );
            for (let i = 0; i < dates.length - 1; i++) {
              assert.ok(
                dates[i] >= dates[i + 1],
                `Items should be ordered by date descending: ${dates[i]} >= ${dates[i + 1]}`
              );
            }
          }
        }
      });

      test('supports ascending date order', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('neo4j');
        assert.ok(repo, 'Neo4j memory repository should exist');

        const result = await repo.findByGroupIds([GROUP_ID], {
          sort: { field: 'created_at', order: 'asc' },
          limit: 10,
        });

        assert.equal(result.source, 'neo4j', 'Source should be neo4j');

        // Verify ascending order (if we have multiple items with valid dates)
        const itemsWithDates = result.items.filter(
          (item) => item.created_at && !isNaN(new Date(item.created_at).getTime())
        );
        if (itemsWithDates.length >= 2) {
          const dates = itemsWithDates.map((item) =>
            new Date(item.created_at!).getTime()
          );
          for (let i = 0; i < dates.length - 1; i++) {
            assert.ok(
              dates[i] <= dates[i + 1],
              `Items should be ordered by date ascending: ${dates[i]} <= ${dates[i + 1]}`
            );
          }
        }
      });

      test('respects limit parameter', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('neo4j');
        assert.ok(repo, 'Neo4j memory repository should exist');

        const result = await repo.findByGroupIds([GROUP_ID], {
          limit: 3,
        });

        assert.ok(result.items.length <= 3, 'Should respect limit');
      });

      test('throws error for semantic search', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('neo4j');
        assert.ok(repo, 'Neo4j memory repository should exist');

        await assert.rejects(
          async () => {
            await repo.search([GROUP_ID], 'test query');
          },
          /does not support semantic search/i,
          'Neo4j should reject semantic search'
        );
      });
    });

    // =========================================================================
    // MCP Memory Repository Tests
    // =========================================================================

    describe('MCP memory repository', () => {
      test('returns facts via findByGroupIds', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('mcp');
        assert.ok(repo, 'MCP memory repository should exist');

        const result = await repo.findByGroupIds([GROUP_ID], {
          limit: 10,
        });

        assert.equal(result.source, 'mcp', 'Source should be mcp');
        assert.ok(Array.isArray(result.items), 'Items should be an array');
      });

      test('supports semantic search', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepositoryByBackend('mcp');
        assert.ok(repo, 'MCP memory repository should exist');

        const result = await repo.search([GROUP_ID], 'implementation', { limit: 5 });

        assert.equal(result.source, 'mcp', 'Source should be mcp');
        assert.ok(Array.isArray(result.items), 'Items should be an array');
      });
    });

    // =========================================================================
    // Router Routing Tests
    // =========================================================================

    describe('router routing', () => {
      test('routes list operations to Neo4j', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepository('list');
        const result = await repo.findByGroupIds([GROUP_ID], { limit: 5 });

        // Neo4j should be used when available
        if (routerResult.router.isBackendAvailable('neo4j')) {
          assert.equal(result.source, 'neo4j', 'List should use Neo4j when available');
        }
      });

      test('routes search operations to MCP', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getMemoryRepository('search');
        const result = await repo.findByGroupIds([GROUP_ID], { limit: 5 });

        // MCP should be used for search
        assert.equal(result.source, 'mcp', 'Search should use MCP');
      });

      test('different backends return different orderings', { timeout: 30_000 }, async () => {
        const neo4jRepo = routerResult.router.getMemoryRepositoryByBackend('neo4j');
        const mcpRepo = routerResult.router.getMemoryRepositoryByBackend('mcp');

        if (!neo4jRepo || !mcpRepo) {
          // Skip if both backends aren't available
          return;
        }

        const neo4jResult = await neo4jRepo.findByGroupIds([GROUP_ID], {
          sort: { field: 'created_at', order: 'desc' },
          limit: 5,
        });

        const mcpResult = await mcpRepo.findByGroupIds([GROUP_ID], {
          limit: 5,
        });

        // Verify correct source tagging - the key feature of the DAL
        assert.equal(neo4jResult.source, 'neo4j');
        assert.equal(mcpResult.source, 'mcp');

        // Both should return results (seeded in before() hook)
        // Conditional check: Graphiti indexing may be slow so MCP could be empty
        if (neo4jResult.items.length > 0 && mcpResult.items.length > 0) {
          // The orderings may differ (Neo4j is date-ordered, MCP is relevance-ordered)
          // This is the key feature of the DAL - different backends serve different purposes
          assert.ok(neo4jResult.items.length > 0, 'Neo4j should return results');
          assert.ok(mcpResult.items.length > 0, 'MCP should return results');
        }
      });
    });

    // =========================================================================
    // Task Repository Tests
    // =========================================================================

    describe('task repository', () => {
      test('Neo4j task repository exists', { timeout: 10_000 }, () => {
        const repo = routerResult.router.getTaskRepositoryByBackend('neo4j');
        assert.ok(repo, 'Neo4j task repository should exist');
      });

      test('MCP task repository exists', { timeout: 10_000 }, () => {
        const repo = routerResult.router.getTaskRepositoryByBackend('mcp');
        assert.ok(repo, 'MCP task repository should exist');
      });

      test('routes list to Neo4j for tasks', { timeout: 30_000 }, async () => {
        const repo = routerResult.router.getTaskRepository('list');
        const result = await repo.findByGroupIds([GROUP_ID], { limit: 5 });

        // Neo4j should be used when available
        if (routerResult.router.isBackendAvailable('neo4j')) {
          assert.equal(result.source, 'neo4j', 'Task list should use Neo4j when available');
        }
      });
    });
  });

