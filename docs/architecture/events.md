# Event-Driven Architecture

Lisa uses an **event-driven architecture** where CLI lifecycle events trigger handlers. This document describes the event flow, handler patterns, and integration points.

## Event Flow

```text
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  CLI Event   │ ──> │  Mediator        │ ──> │  Handler         │
│  (Hook)      │     │  (Application)   │     │  (Application)   │
└──────────────┘     └──────────────────┘     └──────────────────┘
                                                      │
                                              ┌───────┴───────┐
                                              │               │
                                        ┌─────v─────┐  ┌─────v─────┐
                                        │  Services  │  │  DAL      │
                                        │  (Infra)   │  │  (Infra)  │
                                        └───────────┘  └───────────┘
```

1. **Claude Code** triggers a lifecycle event (session start, stop, prompt submit)
2. **Hook commands** in `src/lib/commands/hooks.ts` read stdin and bootstrap the DI container
3. **Mediator** routes the typed request to the appropriate handler
4. **Handlers** in `src/lib/application/handlers/` orchestrate domain services
5. **Services** in `src/lib/infrastructure/services/` execute domain logic
6. **DAL** in `src/lib/infrastructure/dal/` persists/retrieves data

## Lisa Events

| Event | Trigger | CLI Command | Handler |
|-------|---------|-------------|---------|
| `session:start` | New/resume/compact/clear session | `lisa hook session-start` | `SessionStartHandler` |
| `session:stop` | Claude stops responding | `lisa hook session-stop` | `SessionStopHandler` |
| `prompt:submit` | User submits prompt | `lisa hook user-prompt-submit` | `PromptSubmitHandler` |

## Event Mapping to Claude Code Hooks

| Lisa Event | Claude Code Hook | Trigger Types |
|------------|-----------------|---------------|
| `session:start` (startup) | `SessionStart` | `trigger=startup` |
| `session:start` (resume) | `SessionStart` | `trigger=resume` |
| `session:start` (compact) | `SessionStart` | `trigger=compact` |
| `session:start` (clear) | `SessionStart` | `trigger=clear` |
| `session:stop` | `Stop` | Session idle/complete |
| `prompt:submit` | `UserPromptSubmit` | User sends message |

## Handler Architecture

### Handler Location

All event handlers live in a single canonical location:

```text
src/lib/application/handlers/
├── SessionStartHandler.ts
├── SessionStopHandler.ts
├── PromptSubmitHandler.ts
├── pr/                           # PR-related handlers
│   ├── PrCreateHandler.ts
│   ├── PrReviewHandler.ts
│   └── ...
└── index.ts
```

### Mediator Pattern

Handlers implement `IRequestHandler` and are routed via a mediator:

```typescript
interface IRequestHandler<TRequest, TResult> {
  handle(request: TRequest): Promise<TResult>;
}
```

Each event has a corresponding **request** and **result** type:

| Handler | Request | Result |
|---------|---------|--------|
| `SessionStartHandler` | `SessionStartRequest` | `ISessionStartResult` |
| `SessionStopHandler` | `SessionStopRequest` | `ISessionStopResult` |
| `PromptSubmitHandler` | `PromptSubmitRequest` | `IPromptSubmitResult` |

Request and result types are defined in `src/lib/application/mediator/requests/`.

### Handler Constructor Pattern

Handlers support two constructor signatures for flexibility:

```typescript
class SessionStartHandler implements IRequestHandler<SessionStartRequest, ISessionStartResult> {
  // Legacy: ILisaServices bag
  constructor(services: ILisaServices);

  // Preferred: individual service injection
  constructor(
    context: ILisaContext,
    memory: IMemoryService,
    tasks: ITaskService,
    mcp: IMcpClient,
    router?: IRepositoryRouter,
    logger?: ILogger,
    githubSync?: IGitHubSyncService,
    gitClient?: IGitClient,
  );
}
```

## Session Start Event

### Input (from Claude Code)

```typescript
interface ISessionStartInput {
  source?: string;       // "startup", "resume", "compact", "clear"
  trigger?: string;      // Explicit trigger (preferred)
  session_type?: string; // "new" or "existing" (legacy)
  cwd?: string;
  session_id?: string;
}
```

The `parseTrigger()` function resolves the trigger from multiple possible fields:
1. Explicit `trigger` field (preferred)
2. `source` field (direct mapping)
3. `session_type` field (`"new"` → `startup`, `"existing"` → `resume`)
4. Default: `startup`

### Output

```typescript
interface ISessionStartResult {
  message: string;             // Human-readable status
  memories: IMemoryResult;     // Loaded facts, tasks, rules
  tasks: readonly ITask[];     // Processed tasks from memory
  taskCounts: ITaskCounts;     // Task counts by status
  contextContent: string;      // Formatted content for Claude Code
  timedOut: boolean;           // Whether load timed out (partial results)
}
```

The `contextContent` string is injected into Claude Code via stdout as `hookSpecificOutput.additionalContext`.

### Processing Flow

1. **Sync GitHub issues** (fire-and-forget on startup only)
2. **Compute date options** - startup: since midnight; resume/compact/clear: last 24h
3. **Load memory** via `MemoryContextLoader` (DAL or MCP strategy)
4. **Load git commits** via `GitIntrospectionService`
5. **Process tasks** - deduplicate by task key, sort by creation date
6. **Format context** via `SessionContextFormatter`
7. **Return result** with formatted content and trigger-specific message

### Trigger-Specific Behavior

| Trigger | Behavior |
|---------|----------|
| `startup` | Full context load since midnight, GitHub sync, "Memory loaded for session start" |
| `resume` | Context from last 24h, "Memory loaded for session resume" |
| `compact` | Context from last 24h, "Memory reloaded after context compaction" + skills reminder |
| `clear` | Context from last 24h, "Memory loaded after context clear" + fresh start reminder |

## Session Stop Event

### Input (from Claude Code)

```typescript
interface ISessionStopInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}
```

### Processing Flow

1. **Capture session work** via `ISessionCaptureService` (transcript parsing + heuristic detectors)
2. **Generate suggestions** (e.g., unlinked tasks that could be GitHub issues)
3. **Skip if no facts** - return early with skip reason
4. **Add quality tags** - `type:session-capture`, `source:session-capture`, `confidence:medium`, optional `taskType:<type>`
5. **Save facts** via `addFactWithLifecycle()` with `session` lifecycle
6. **Emit event** - `memory:save` event for listeners

### Output

```typescript
interface ISessionStopResult {
  message: string;
  factsCaptured: number;
  skipped: boolean;
  skipReason?: string;
  suggestions?: readonly ISessionStopSuggestion[];
}

interface ISessionStopSuggestion {
  action: string;      // e.g., "sync-github-export"
  message: string;     // Human-readable description
  command: string;     // CLI command to execute
  count?: number;      // Number of items this applies to
}
```

## Prompt Submit Event

### Input (from Claude Code)

```typescript
interface IPromptSubmitInput {
  prompt?: string;           // Prompt content (preferred)
  content?: string;          // Prompt content (alternative)
  permission_mode?: string;  // "plan", "default", etc.
  permissionMode?: string;   // Alternative casing
  session_id?: string;
}
```

### Processing Flow

1. **Run memory recursion** (plan mode only) - queries memory for related context
2. **Truncate prompt** to 200 characters for storage
3. **Save to memory** with `ephemeral` lifecycle and `type:prompt` tag (fire-and-forget)
4. **Return result** with optional recursion context

### Output

```typescript
interface IPromptSubmitResult {
  content: string;              // Processed prompt (unchanged)
  blocked: boolean;             // Whether prompt was blocked
  blockReason?: string;
  planModeRecursion: boolean;   // Whether plan mode recursion found context
  additionalContext?: string;   // Related context from memory
  recursion?: IRecursionResult; // @deprecated - use planModeRecursion
}
```

## Hook Registration

Hooks are registered in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "lisa hook session-start" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "lisa hook session-stop" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "lisa hook user-prompt-submit" }
        ]
      }
    ]
  }
}
```

## Hook I/O Protocol

### Input: stdin (JSON)

Claude Code pipes JSON to the hook's stdin. The `readJsonFromStdin()` utility reads with a 100ms timeout:

```typescript
const input = await readJsonFromStdin<ISessionStartInput>();
```

If stdin is empty or times out, an empty object `{}` is returned.

### Output: stdout (JSON) for SessionStart

SessionStart returns context via stdout as `IHookOutput`:

```typescript
const output: IHookOutput = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: result.contextContent,
  },
};
await writeJsonToStdout(output);
```

### Status: stderr (text)

Status messages go to stderr and are shown to the user:

```typescript
await writeStatus(result.message);  // Writes to stderr
```

## Error Handling

### Graceful Degradation

Hooks must not block Claude Code operation:

```typescript
try {
  const result = await mediator.send(request);
  await writeJsonToStdout(output);
  await writeStatus(result.message);
} catch (error) {
  // On error, still output something to not block session
  const output: IHookOutput = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Memory load skipped: ${errorMessage}`,
    },
  };
  await writeJsonToStdout(output);
  await writeStatus(`Memory load failed: ${errorMessage}`);
}
```

Session stop and prompt submit hooks catch all errors silently - they only write a status message to stderr on failure.

### DI Container Lifecycle

Each hook invocation bootstraps a fresh DI container and disposes it in a `finally` block:

```typescript
const bootstrap = await bootstrapContainer({ projectRoot: input.cwd || process.cwd() });
try {
  const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);
  // ... handle request
} finally {
  if (bootstrap.dispose) await bootstrap.dispose();
}
```

## Testing Hooks

### Manual Testing

```bash
# Test session-start hook
echo '{"trigger":"startup"}' | lisa hook session-start

# Test session-stop hook
echo '{"session_id":"test"}' | lisa hook session-stop

# Test user-prompt-submit hook
echo '{"prompt":"test prompt","permission_mode":"default"}' | lisa hook user-prompt-submit
```

### Unit Testing

Handlers can be unit tested with mocked services:

```typescript
describe('SessionStartHandler', () => {
  it('should load memories on startup', async () => {
    const handler = new SessionStartHandler(
      mockContext, mockMemory, mockTasks, mockMcp,
      mockRouter, mockLogger, undefined, mockGitClient
    );
    const request = new SessionStartRequest('startup', '2025-01-01T00:00:00.000Z');
    const result = await handler.handle(request);

    expect(result.contextContent).toContain('Memory loaded');
    expect(result.timedOut).toBe(false);
  });
});
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/commands/hooks.ts` | CLI hook command registration (`lisa hook *`) |
| `src/lib/application/handlers/SessionStartHandler.ts` | Session start handler |
| `src/lib/application/handlers/SessionStopHandler.ts` | Session stop handler |
| `src/lib/application/handlers/PromptSubmitHandler.ts` | Prompt submit handler |
| `src/lib/application/mediator/requests/SessionStartRequest.ts` | Session start request type |
| `src/lib/application/mediator/requests/SessionStopRequest.ts` | Session stop request + result types |
| `src/lib/application/mediator/requests/PromptSubmitRequest.ts` | Prompt submit request + result types |
| `src/lib/application/interfaces/ISessionStartResult.ts` | Session start result type |
| `src/lib/application/services/SessionContextFormatter.ts` | Context formatting for output |
| `src/lib/application/services/MemoryContextLoader.ts` | Memory loading (DAL/MCP strategy) |
| `src/lib/application/services/GitIntrospectionService.ts` | Git commit loading |
| `src/lib/infrastructure/cli/io.ts` | Stdin/stdout/stderr I/O utilities |
| `src/lib/infrastructure/services/SessionCaptureService.ts` | Transcript parsing + heuristic detectors |
| `.claude/settings.json` | Hook registration for Claude Code |

## Best Practices

1. **Non-blocking** - Hooks should complete quickly; session stop spawns background capture
2. **Graceful degradation** - Never fail the hook; return empty/default on error
3. **Idempotent** - Same input should produce same output
4. **Logging** - Log errors for debugging but don't expose to user
5. **DI lifecycle** - Always dispose the container in a `finally` block
6. **Fire-and-forget** - GitHub sync and prompt recording use fire-and-forget to avoid blocking
