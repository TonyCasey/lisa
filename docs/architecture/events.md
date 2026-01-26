# Event-Driven Architecture

Lisa uses an **event-driven architecture** where CLI lifecycle events trigger handlers. This document describes the event flow, handler patterns, and integration points.

## Event Flow

```text
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  CLI Event   │ ──> │  Event Handler  │ ──> │  Domain Services │
│  (Hook)      │     │  (Application)  │     │  (Infrastructure)│
└──────────────┘     └─────────────────┘     └──────────────────┘
```

1. **Claude Code** triggers a lifecycle event (session start, stop, prompt submit)
2. **Hooks** (registered in `.claude/settings.json`) invoke Lisa CLI commands
3. **Handlers** in `src/lib/application/handlers/` process the event
4. **Services** in `src/lib/infrastructure/services/` execute domain logic
5. **Repositories** in `src/lib/infrastructure/dal/` persist/retrieve data

## Lisa Events

| Event | Trigger | CLI Command | Handler |
|-------|---------|-------------|---------|
| `session:start` | New/resume/compact/clear session | `lisa hook session-start` | `SessionStartHookHandler` |
| `session:stop` | Claude stops responding | `lisa hook session-stop` | `SessionStopHookHandler` |
| `prompt:submit` | User submits prompt | `lisa hook user-prompt-submit` | `UserPromptSubmitHookHandler` |

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
src/lib/application/handlers/hooks/
├── SessionStartHookHandler.ts
├── SessionStopHookHandler.ts
├── UserPromptSubmitHookHandler.ts
├── types.ts
├── utils.ts
└── index.ts
```

### Handler Pattern

Each handler implements a consistent pattern:

```typescript
interface IHookHandler<TInput, TOutput> {
  handle(input: TInput): Promise<TOutput>;
}

class SessionStartHookHandler implements IHookHandler<ISessionStartInput, ISessionStartOutput> {
  constructor(
    private readonly memoryRepository: IMemoryRepository,
    private readonly taskRepository: ITaskRepository,
    private readonly logger: ILogger
  ) {}

  async handle(input: ISessionStartInput): Promise<ISessionStartOutput> {
    // 1. Parse input from stdin
    // 2. Load context (memories, tasks, rules)
    // 3. Format output for Claude Code
    // 4. Return result
  }
}
```

## Session Start Event

### Input

```typescript
interface ISessionStartInput {
  source: 'startup' | 'resume' | 'compact' | 'clear';
  session_id?: string;
  cwd?: string;
}
```

### Output

The handler outputs context for Claude Code to inject:

```typescript
interface ISessionStartOutput {
  memories: IMemoryItem[];
  tasks: ITask[];
  rules: string[];
  message: string;
}
```

### Trigger-Specific Behavior

| Trigger | Behavior |
|---------|----------|
| `startup` | Full context load, "Memory loaded for session start" |
| `resume` | Full context load, "Memory loaded for session resume" |
| `compact` | Full context reload, "Memory reloaded after context compaction" + skills reminder |
| `clear` | Full context reload, "Memory loaded after context clear" + fresh start reminder |

## Session Stop Event

### Input

```typescript
interface ISessionStopInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}
```

### Processing Flow

1. **Spawn background worker** - Non-blocking capture
2. **Find transcript** - Locate Claude Code transcript file
3. **Parse transcript** - Extract work summary
4. **Filter insignificant work** - Skip trivial sessions
5. **Build facts** - Generate memory items
6. **Store to memory** - Persist via repository

### Output

```typescript
interface ISessionStopOutput {
  captured: boolean;
  facts?: string[];
  complexity?: 'low' | 'medium' | 'high';
}
```

## Prompt Submit Event

### Input

```typescript
interface IPromptSubmitInput {
  prompt: string;
  session_id?: string;
  cwd?: string;
}
```

### Processing

1. **Log prompt** - Store for retrospective analysis
2. **Validate** - Check for required patterns (optional)
3. **Pass through** - Return prompt unchanged

### Output

```typescript
interface IPromptSubmitOutput {
  prompt: string;  // Potentially modified prompt
  logged: boolean;
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

## Error Handling

### Graceful Degradation

Hooks must not block Claude Code operation:

```typescript
async handle(input: ISessionStartInput): Promise<ISessionStartOutput> {
  try {
    const memories = await this.memoryRepository.list({ limit: 10 });
    return { memories, message: 'Memory loaded' };
  } catch (error) {
    this.logger.warn('Failed to load memories', { error });
    return { memories: [], message: 'Memory unavailable' };
  }
}
```

### Timeout Handling

All hook operations respect timeouts:

```typescript
const HOOK_TIMEOUT_MS = 5000;

const result = await Promise.race([
  this.loadContext(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Hook timeout')), HOOK_TIMEOUT_MS)
  )
]);
```

## Testing Hooks

### Manual Testing

```bash
# Test session-start hook
echo '{"source":"startup"}' | lisa hook session-start

# Test session-stop hook
echo '{"session_id":"test"}' | lisa hook session-stop

# Test user-prompt-submit hook
echo '{"prompt":"test"}' | lisa hook user-prompt-submit
```

### Unit Testing

```typescript
describe('SessionStartHookHandler', () => {
  it('should load memories on startup', async () => {
    const handler = new SessionStartHookHandler(mockMemoryRepo, mockTaskRepo, mockLogger);
    const result = await handler.handle({ source: 'startup' });
    
    expect(result.memories).toHaveLength(5);
    expect(result.message).toContain('session start');
  });
});
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/application/handlers/hooks/SessionStartHookHandler.ts` | Session start handler |
| `src/lib/application/handlers/hooks/SessionStopHookHandler.ts` | Session stop handler |
| `src/lib/application/handlers/hooks/UserPromptSubmitHookHandler.ts` | Prompt submit handler |
| `src/lib/application/handlers/hooks/types.ts` | Input/output type definitions |
| `src/lib/cli.ts` | CLI command registration for `lisa hook *` |
| `.claude/settings.json` | Hook registration for Claude Code |

## Best Practices

1. **Non-blocking** - Hooks should complete quickly or spawn background workers
2. **Graceful degradation** - Never fail the hook; return empty/default on error
3. **Idempotent** - Same input should produce same output
4. **Logging** - Log errors for debugging but don't expose to user
5. **Timeouts** - Respect timeout constraints (typically 5s for hooks)
