# DAL Routing Strategy

Lisa's Data Access Layer (DAL) uses a **strategy-based routing pattern** to select the optimal backend for each operation type, with fallback behavior when backends are unavailable.

## Backend Sources

Lisa supports three backend sources:

| Backend | Purpose | Configuration |
|---------|---------|---------------|
| **MCP** | Semantic search via Graphiti | `GRAPHITI_ENDPOINT` |
| **Neo4j** | Efficient date ordering, aggregation | `NEO4J_URI` |
| **Zep** | Cloud-hosted alternative | `ZEP_API_KEY` |

## Operation Types

```typescript
type OperationType = 'list' | 'search' | 'write' | 'aggregate';
```

| Operation | Description | Preferred Backend |
|-----------|-------------|-------------------|
| `list` | Date-ordered listing | Neo4j (efficient Cypher) |
| `search` | Semantic search | MCP (Graphiti) |
| `write` | Write operations | MCP (ingestion pipeline) |
| `aggregate` | Counts, statistics | Neo4j (efficient aggregation) |

## Default Routing Rules

```typescript
export const DEFAULT_ROUTING_RULES: readonly IRoutingRule[] = [
  { operation: 'list', preferred: 'neo4j', fallback: 'mcp' },
  { operation: 'search', preferred: 'mcp', fallback: 'zep' },
  { operation: 'write', preferred: 'mcp', fallback: 'zep' },
  { operation: 'aggregate', preferred: 'neo4j', fallback: 'mcp' },
];
```

## Routing Resolution Algorithm

The router uses a three-tier fallback strategy:

```typescript
resolveBackend(operation, repositories): BackendSource {
  const rule = this.routingRules.get(operation);

  // 1. Try preferred backend
  if (repositories.has(rule.preferred)) {
    return rule.preferred;
  }

  // 2. Try fallback backend
  if (rule.fallback && repositories.has(rule.fallback)) {
    return rule.fallback;
  }

  // 3. Try any available backend
  for (const backend of repositories.keys()) {
    return backend;
  }

  // 4. Error if none available
  throw new Error(`No backend available for operation '${operation}'`);
}
```

## Fallback Behavior

### Backend Initialization Fallback

During factory initialization, each backend is tried independently:

```typescript
// RepositoryFactory.ts
if (enableMcp) {
  try {
    const mcpConnection = createMcpConnectionManager(endpoint, apiKey);
    await mcpConnection.connect();
    router.registerMemoryRepository('mcp', mcpMemoryRepo);
    availableBackends.push('mcp');
  } catch (error) {
    logger.warn('MCP backend unavailable', { error });
    // Continue to try other backends
  }
}
```

### Minimum Backend Requirement

At least one backend must be available:

```typescript
if (availableBackends.length === 0) {
  throw new Error(
    'No DAL backends available. Please configure at least one of: ' +
    'MCP (GRAPHITI_ENDPOINT), Neo4j (NEO4J_URI), or Zep (ZEP_API_KEY).'
  );
}
```

## Configuration

### Environment Variables

| Variable | Backend | Default |
|----------|---------|---------|
| `GRAPHITI_ENDPOINT` | MCP | `http://localhost:8010/mcp/` |
| `ZEP_API_KEY` | MCP/Zep | (required for Zep Cloud) |
| `NEO4J_URI` | Neo4j | `bolt://localhost:7687` |
| `NEO4J_USER` | Neo4j | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j | `demodemo` |
| `NEO4J_DATABASE` | Neo4j | `neo4j` |

### Programmatic Configuration

```typescript
interface IRepositoryFactoryConfig {
  // Enable/disable specific backends
  mcp?: boolean;
  neo4j?: boolean;
  zep?: boolean;

  // Override endpoints/credentials
  mcpEndpoint?: string;
  mcpApiKey?: string;
  neo4jUri?: string;
  neo4jUsername?: string;
  neo4jPassword?: string;
  neo4jDatabase?: string;
  zepApiKey?: string;
  zepEndpoint?: string;
  
  logger?: ILogger;
}
```

### Runtime Rule Updates

```typescript
// Change routing at runtime
router.setRoutingRule('list', 'mcp', 'neo4j');  // Now list prefers MCP
```

## Usage Examples

### Get Repository by Operation Type

```typescript
// Routes to preferred backend based on operation
const memoryRepo = router.getMemoryRepository('search');  // → MCP
const listRepo = router.getMemoryRepository('list');      // → Neo4j
```

### Get Repository by Backend

```typescript
// Force specific backend
if (router.isBackendAvailable('neo4j')) {
  const neo4jRepo = router.getMemoryRepositoryByBackend('neo4j');
}
```

### Create Router with Custom Config

```typescript
const { router, connections, availableBackends } = await createRepositoryRouter({
  mcp: true,
  neo4j: true,
  zep: false,  // Disable Zep
});

// Use router...

// Cleanup
await closeConnections(connections);
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    RepositoryFactory                        │
│  - Creates connections                                      │
│  - Registers repositories                                   │
│  - Returns router + connection handles                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    RepositoryRouter                         │
│                                                             │
│  Routing Rules:                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  list      → Neo4j (fallback: MCP)                  │   │
│  │  search    → MCP   (fallback: Zep)                  │   │
│  │  write     → MCP   (fallback: Zep)                  │   │
│  │  aggregate → Neo4j (fallback: MCP)                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Repository Maps:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Memory: { mcp: McpMemoryRepo, neo4j: Neo4jMemRepo } │   │
│  │  Task:   { mcp: McpTaskRepo, neo4j: Neo4jTaskRepo }  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌───────────┐   ┌───────────┐   ┌───────────┐
       │    MCP    │   │   Neo4j   │   │    Zep    │
       │ (Graphiti)│   │ (Direct)  │   │  (Cloud)  │
       └───────────┘   └───────────┘   └───────────┘
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/domain/interfaces/dal/types.ts` | `BackendSource`, `OperationType` |
| `src/lib/domain/interfaces/dal/IRepositoryRouter.ts` | Router interface, `DEFAULT_ROUTING_RULES` |
| `src/lib/infrastructure/dal/routing/RepositoryRouter.ts` | Router implementation |
| `src/lib/infrastructure/dal/RepositoryFactory.ts` | Factory with fallback logic |
| `src/lib/infrastructure/dal/connections/` | Connection managers per backend |

## Best Practices

1. **Configure multiple backends** - Provides resilience if one is unavailable
2. **Use operation-specific routing** - Each operation type has optimal backend
3. **Handle fallbacks gracefully** - Application continues with degraded functionality
4. **Log routing decisions** - Helps debug which backend was selected
5. **Close connections** - Always call `closeConnections()` when done
