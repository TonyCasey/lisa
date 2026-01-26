# Timeout Semantics

Lisa uses timeouts consistently throughout the codebase to prevent operations from blocking indefinitely. The pattern uses native `AbortSignal.timeout()` for HTTP fetches and custom cancellation utilities for complex async workflows.

## Default Timeout Values

| Component | Constant | Default | Location |
|-----------|----------|---------|----------|
| MCP Client (infrastructure) | `DEFAULT_TIMEOUT_MS` | 8s | `src/lib/infrastructure/mcp/McpClient.ts` |
| MCP Client (skills) | `timeoutMs` | 30s | `src/lib/skills/shared/clients/McpClient.ts` |
| MCP Connection Manager | `timeout` | 30s | `src/lib/infrastructure/dal/connections/McpConnectionManager.ts` |
| Memory Service | `MEMORY_LOAD_TIMEOUT_MS` | 5s | `src/lib/infrastructure/services/MemoryService.ts` |
| Session Start Handler | `TIMEOUT_MS` | 5s | `src/lib/application/handlers/SessionStartHandler.ts` |
| Zep Client | `DEFAULT_TIMEOUT_MS` | 15s | `src/lib/skills/shared/clients/ZepClient.ts` |
| Zep Connection Manager | `timeout` | 15s | `src/lib/infrastructure/dal/connections/ZepConnectionManager.ts` |
| GitHub CLI Client | `DEFAULTS.timeoutMs` | 30s | `src/lib/skills/shared/clients/GhCliClient.ts` |
| Stdin Read | `DEFAULT_STDIN_TIMEOUT_MS` | 100ms | `src/lib/infrastructure/cli/io.ts` |
| Scanner Reviewer | `TIMEOUT_MS` | 30s | `src/lib/scanner/reviewer.ts` |
| Doctor Command | inline | 10s | `src/lib/commands/doctor.ts` |

## Environment Variable Configuration

| Variable | Component | Purpose |
|----------|-----------|---------|
| `GH_TIMEOUT_MS` | GhCliClient | Override GitHub CLI timeout |

Most timeouts are **not** configurable via environment variables; they use hardcoded constants optimized for typical usage patterns.

## Timeout Implementation Patterns

### 1. AbortSignal.timeout() for HTTP Fetches

Used in MCP and Zep clients for HTTP requests:

```typescript
const resp = await fetch(this.endpoint, {
  method: 'POST',
  headers: this.getHeaders(),
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(timeoutMs),
});
```

### 2. Cancellation Token Pattern

For complex async workflows, Lisa implements a robust cancellation pattern in `src/lib/domain/utils/cancellation.ts`.

#### Core Types

```typescript
interface CancellableOptions {
  timeoutMs?: number;        // Timeout in milliseconds
  signal?: AbortSignal;      // External abort signal to combine
  onCancel?: () => void;     // Cleanup callback
}

interface CancellableResult<T> {
  value?: T;                 // Result if completed successfully
  cancelled: boolean;        // Whether operation was cancelled
  timedOut: boolean;         // Whether operation timed out specifically
  error?: Error;             // Error if failed (not due to cancellation)
}
```

#### Usage Pattern

```typescript
import { withCancellation, checkCancellation } from './domain/utils/cancellation';

const result = await withCancellation(
  async (abortSignal) => {
    // Check cancellation at key points
    checkCancellation(abortSignal, 'Operation cancelled before step 1');
    
    await step1();
    
    checkCancellation(abortSignal, 'Operation cancelled after step 1');
    
    await step2();
    
    return finalResult;
  },
  {
    timeoutMs: 5000,
    signal: externalSignal,  // Optional external abort signal
    onCancel: () => {
      logger.debug('Operation cancelled');
    },
  }
);

if (result.timedOut) {
  // Handle timeout
}
```

### 3. Process Spawn Timeout

For spawned processes (e.g., scanner reviewer), manual timeout handling is required:

```typescript
const TIMEOUT_MS = 30000;
let resolved = false;

const child = spawn('node', [scriptPath, 'run', '--force'], {
  cwd: projectPath,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const timeoutId = setTimeout(() => {
  if (!resolved) {
    resolved = true;
    child.kill('SIGTERM');
    resolve(fallbackResult);
  }
}, TIMEOUT_MS);

child.on('close', (code) => {
  clearTimeout(timeoutId);
  // Handle result
});
```

## Error Handling

### TimeoutError Class

```typescript
export class TimeoutError extends LisaError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    data?: Record<string, unknown>
  ) {
    super(message, 'TIMEOUT_ERROR', { ...data, timeoutMs });
    this.name = 'TimeoutError';
  }
}
```

### CancellationError Class

```typescript
export class CancellationError extends Error {
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}
```

## Structured Logging

Timeout events are logged with structured log events:

```typescript
export const LogEvents = {
  MEMORY_LOAD_TIMEOUT: 'memory:load:timeout',
  // ...
} as const;
```

## Best Practices

1. **Use appropriate timeouts** - Hook operations should be fast (5s), background operations can be longer (30s)
2. **Check cancellation at boundaries** - Add `checkCancellation()` calls before expensive operations
3. **Handle timeout gracefully** - Return partial results or fallback data instead of throwing
4. **Log timeout events** - Use structured logging for monitoring and debugging
5. **Combine abort signals** - Use `combineAbortSignals()` when multiple cancellation sources exist
