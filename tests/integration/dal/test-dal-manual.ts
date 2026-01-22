#!/usr/bin/env npx tsx
/**
 * DAL Integration Test Script
 * 
 * Tests the Data Access Layer routing to verify:
 * 1. Neo4j backend returns date-ordered results for 'list' operations
 * 2. MCP backend returns semantic search results for 'search' operations
 * 3. Router correctly routes to optimal backend
 * 4. Full MemoryService integration works with router
 * 
 * Usage:
 *   npx tsx scripts/test-dal.ts
 * 
 * Requires:
 *   - Docker containers running (docker compose up)
 *   - NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD env vars (or defaults)
 */

import {
  createRepositoryRouter,
  closeConnections,
} from '../../../src/lib/infrastructure/dal';
import { createServicesWithCleanup } from '../../../src/lib/infrastructure/di';

const GROUP_ID = 'lisa'; // Group ID as stored in Neo4j

async function main() {
  console.log('=== DAL Integration Test ===\n');

  // Create router with all available backends
  console.log('1. Creating repository router...');
  
  let result;
  try {
    result = await createRepositoryRouter({
      mcpEndpoint: process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/',
      neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4jUsername: process.env.NEO4J_USER || 'neo4j',
      neo4jPassword: process.env.NEO4J_PASSWORD || 'demodemo',
    });
  } catch (err) {
    console.error('Failed to create router:', (err as Error).message);
    process.exit(1);
  }

  const { router, connections, availableBackends } = result;
  console.log(`   Available backends: ${availableBackends.join(', ')}`);
  console.log(`   Routing rules:`);
  for (const rule of router.getRoutingRules()) {
    console.log(`     ${rule.operation}: ${rule.preferred} -> ${rule.fallback || 'none'}`);
  }
  console.log();

  try {
    // Test 1: List operation (should use Neo4j)
    console.log('2. Testing LIST operation (should use Neo4j for date ordering)...');
    const listRepo = router.getMemoryRepository('list');
    console.log(`   Router selected: ${router.isBackendAvailable('neo4j') ? 'neo4j' : 'mcp'}`);
    
    const listResult = await listRepo.findByGroupIds([GROUP_ID], {
      sort: { field: 'created_at', order: 'desc' },
      limit: 5,
    });
    
    console.log(`   Found ${listResult.items.length} facts from ${listResult.source} (newest first):`);
    for (const fact of listResult.items.slice(0, 5)) {
      const date = fact.created_at ? new Date(fact.created_at).toISOString().slice(0, 16) : 'unknown';
      const text = fact.fact?.slice(0, 60) || fact.name?.slice(0, 60) || 'no text';
      console.log(`     [${date}] ${text}...`);
    }
    console.log();

    // Test 2: Search operation (should use MCP)
    console.log('3. Testing SEARCH operation (should use MCP for semantic search)...');
    const searchRepo = router.getMemoryRepository('search');
    
    try {
      const searchResult = await searchRepo.search(
        [GROUP_ID],
        'DAL implementation',
        { limit: 5 }
      );
      
      console.log(`   Found ${searchResult.items.length} semantic matches from ${searchResult.source}:`);
      for (const fact of searchResult.items.slice(0, 3)) {
        const text = fact.fact?.slice(0, 60) || fact.name?.slice(0, 60) || 'no text';
        console.log(`     ${text}...`);
      }
    } catch (err) {
      console.log(`   Search error: ${(err as Error).message}`);
      // Fallback: use findByGroupIds
      const fallbackResult = await searchRepo.findByGroupIds([GROUP_ID], {
        limit: 5,
      });
      console.log(`   Fallback: Found ${fallbackResult.items.length} facts via findByGroupIds`);
    }
    console.log();

    // Test 3: Compare backends directly
    console.log('4. Comparing backends directly...');
    
    const neo4jRepo = router.getMemoryRepositoryByBackend('neo4j');
    const mcpRepo = router.getMemoryRepositoryByBackend('mcp');
    
    if (neo4jRepo && mcpRepo) {
      const neo4jResult = await neo4jRepo.findByGroupIds([GROUP_ID], {
        sort: { field: 'created_at', order: 'desc' },
        limit: 3,
      });
      
      const mcpResult = await mcpRepo.findByGroupIds([GROUP_ID], {
        limit: 3,
      });
      
      console.log(`   Neo4j returned ${neo4jResult.items.length} facts (date ordered)`);
      console.log(`   MCP returned ${mcpResult.items.length} facts (relevance ordered)`);
      
      if (neo4jResult.items.length > 0 && mcpResult.items.length > 0) {
        const neo4jFirst = neo4jResult.items[0];
        const mcpFirst = mcpResult.items[0];
        
        console.log(`   Neo4j first: ${neo4jFirst.created_at} - ${neo4jFirst.name?.slice(0, 40)}...`);
        console.log(`   MCP first: ${mcpFirst.created_at || 'unknown'} - ${mcpFirst.name?.slice(0, 40)}...`);
      }
    } else {
      console.log('   Could not get both backends for comparison');
    }
    console.log();

    // Test 4: Task repository
    console.log('5. Testing task repository routing...');
    const taskListRepo = router.getTaskRepository('list');
    
    console.log(`   Task list routes to: ${router.isBackendAvailable('neo4j') ? 'neo4j (preferred)' : 'mcp (fallback)'}`);
    console.log(`   Task write routes to: mcp (always, for ingestion pipeline)`);
    
    // Try to get tasks
    try {
      const taskResult = await taskListRepo.findByGroupIds([GROUP_ID], { limit: 3 });
      console.log(`   Found ${taskResult.items.length} tasks from ${taskResult.source}`);
    } catch (err) {
      console.log(`   Task query: ${(err as Error).message}`);
    }
    console.log();

    console.log('=== Router tests completed ===\n');

  } finally {
    // Clean up connections
    console.log('Closing router connections...');
    await closeConnections(connections);
  }

  // Test 5: Full MemoryService integration
  console.log('6. Testing full MemoryService integration...');
  
  let services;
  try {
    services = await createServicesWithCleanup({
      mcpEndpoint: process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/',
      dalConfig: {
        neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4jUsername: process.env.NEO4J_USER || 'neo4j',
        neo4jPassword: process.env.NEO4J_PASSWORD || 'demodemo',
      },
    });
    
    console.log(`   Router available: ${services.router ? 'yes' : 'no'}`);
    
    if (services.router) {
      // Test the new DAL-based methods
      console.log('   Testing loadFactsDateOrdered...');
      const dateOrderedFacts = await services.memory.loadFactsDateOrdered([GROUP_ID], 5);
      console.log(`   Got ${dateOrderedFacts.length} date-ordered facts`);
      
      if (dateOrderedFacts.length > 0) {
        const first = dateOrderedFacts[0];
        console.log(`   Most recent: [${first.created_at?.slice(0, 16)}] ${first.fact?.slice(0, 50)}...`);
      }
      
      console.log('   Testing searchFacts (semantic)...');
      const semanticFacts = await services.memory.searchFacts([GROUP_ID], 'phase implementation', 3);
      console.log(`   Got ${semanticFacts.length} semantic matches`);
      
      if (semanticFacts.length > 0) {
        const first = semanticFacts[0];
        console.log(`   Best match: ${first.fact?.slice(0, 60)}...`);
      }
    } else {
      console.log('   Router not available, skipping DAL-specific tests');
    }
    
    console.log();
    console.log('=== All tests completed ===');
    
  } finally {
    if (services) {
      console.log('\nClosing service connections...');
      await services.cleanup();
    }
    console.log('Done.');
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
