# MCP Session Management

Lisa implements MCP (Model Context Protocol) session management through two client implementations that share similar patterns for session lifecycle, with a singleton-based connection reuse strategy.

## Session Lifecycle

### 1. Create (Initialize)

Sessions are created lazily on first API call or explicitly via `initialize()`:

```typescript
// Lazy initialization - session created on first call()
const [result] = await mcpClient.call('search', { query: 'test' });

// Explicit initialization
const sessionId = await mcpClient.initialize(8000);
```

### 2. Use (Call)

Sessions are reused for all subsequent calls. The client handles:
- Automatic session ID inclusion in headers
- Session ID updates from server responses
- Automatic retry on session expiry (401/403)

### 3. Dispose (Disconnect)

```typescript
await connectionManager.disconnect();
// Or through DI container:
await container.dispose();
```

## Promise Caching (Concurrent Initialization Prevention)

To prevent race conditions when multiple callers try to initialize simultaneously, McpClient uses promise caching:

```typescript
async initialize(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
  // If already initializing, return the pending promise
  if (this.initializePromise) {
    return this.initializePromise;
  }

  // If already have a session, return it
  if (this.sessionId) {
    return this.sessionId;
  }

  // Start initialization
  this.initializePromise = this.doInitialize(timeoutMs);

  try {
    const sessionId = await this.initializePromise;
    return sessionId;
  } finally {
    this.initializePromise = null;
  }
}
```

## Session ID Handling

### Request Headers

Session ID is sent in every request after initialization:

```typescript
const headers = {
  'Content-Type': 'application/json',
  'MCP-SESSION-ID': sessionId,
  // API key if configured
};
```

### Response Header Update

Server can issue new session IDs which the client automatically updates:

```typescript
const newSid = resp.headers.get('mcp-session-id');
if (newSid) {
  this.sessionId = newSid;
}
```

### Session Expiry Handling

On 401/403 responses, the client automatically re-initializes and retries:

```typescript
if ((resp.status === 401 || resp.status === 403) && !isRetry) {
  await this.reinitialize(timeoutMs);
  return this.doCall<T>(method, params, timeoutMs, true);  // isRetry = true
}
```

## Connection Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      DI Container (bootstrap.ts)                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │          McpClient (SINGLETON)                          │   │
│  │  - sessionId: string | null                             │   │
│  │  - initializePromise: Promise<string> | null            │   │
│  │                                                         │   │
│  │  initialize() → doInitialize() → POST /initialize       │   │
│  │       │              │                   │               │   │
│  │       │              │            mcp-session-id header │   │
│  │       ▼              ▼                   ▼               │   │
│  │  Promise Cache   Session stored   Session returned      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │        McpConnectionManager (DAL Layer)                 │   │
│  │  - Wraps McpClient                                      │   │
│  │  - Lazy connect()                                       │   │
│  │  - Shared by McpMemoryRepository, McpTaskRepository     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              RepositoryRouter                           │   │
│  │  - Routes to MCP/Neo4j/Zep based on operation type      │   │
│  │  - All MCP ops share single McpConnectionManager        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Singleton Registration

McpClient is registered as a singleton in the DI container:

```typescript
// bootstrap.ts
const mcp = new McpClient(mcpEndpoint, apiKey);
container.registerInstance(TOKENS.McpClient, mcp);
```

This ensures connection reuse across all handlers and services.

## Connection Manager Pattern

The McpConnectionManager wraps McpClient for DAL layer usage:

```typescript
export class McpConnectionManager implements IMcpConnectionManager {
  private client: McpClient;
  private connected = false;

  constructor(private readonly config: IMcpConnectionConfig) {
    this.client = new McpClient(config.endpoint, config.apiKey);
  }

  async connect(): Promise<void> {
    await this.client.initialize(this.config.timeout);
    this.connected = true;
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    // Lazy initialization
    if (!this.connected) {
      await this.connect();
    }
    const [result] = await this.client.call<T>(method, params, null, this.config.timeout);
    return result;
  }

  async disconnect(): Promise<void> {
    this.connected = false;  // HTTP-based MCP is stateless
  }
}
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/infrastructure/mcp/McpClient.ts` | Primary MCP client with session management |
| `src/lib/domain/interfaces/IMcpClient.ts` | MCP client interface definition |
| `src/lib/infrastructure/dal/connections/McpConnectionManager.ts` | Connection lifecycle wrapper |
| `src/lib/infrastructure/dal/RepositoryFactory.ts` | Creates/disposes connection managers |
| `src/lib/infrastructure/di/bootstrap.ts` | DI container setup (singleton registration) |
| `src/lib/skills/shared/clients/McpClient.ts` | Skills-layer MCP client (similar patterns) |

## Best Practices

1. **Never pass sessionId manually** - The client manages sessions internally
2. **Use singleton pattern** - McpClient should be registered as singleton for connection reuse
3. **Promise caching** - Prevents concurrent initialization race conditions
4. **Auto-retry on expiry** - 401/403 triggers re-initialization and retry
5. **Server-issued sessions** - Client updates sessionId when server returns new one
