# Architecture Documentation

This directory contains technical documentation for Lisa's internal architecture, invariants, and contracts.

## Contents

| Document | Description |
|----------|-------------|
| [Timeout Semantics](./timeouts.md) | Timeout values, cancellation patterns, and error handling |
| [MCP Sessions](./mcp-sessions.md) | MCP session lifecycle, initialization, and connection reuse |
| [DAL Routing](./dal-routing.md) | Backend selection strategy and fallback behavior |
| [Transcripts](./transcripts.md) | Claude Code transcript discovery, parsing, and capture |
| [Events](./events.md) | Event-driven architecture, hooks, and handler patterns |

## Key Architectural Patterns

### Clean Architecture

Lisa follows Clean Architecture principles with clear layer separation:

```text
┌─────────────────────────────────────────────────────────┐
│                    CLI / Presentation                    │
│                    (src/lib/commands/)                   │
│   hooks.ts, knowledge.ts, pr.ts, issue.ts, skills.ts    │
├─────────────────────────────────────────────────────────┤
│                     Application Layer                    │
│            (src/lib/application/handlers/)              │
│   SessionStartHandler, SessionStopHandler, etc.         │
│            (src/lib/application/mediator/)              │
│   Mediator, Requests (SessionStartRequest, etc.)        │
├─────────────────────────────────────────────────────────┤
│                      Domain Layer                        │
│              (src/lib/domain/interfaces/)               │
│   IMemoryRepository, ITaskRepository, IMemoryItem, etc. │
├─────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                   │
│              (src/lib/infrastructure/dal/)              │
│   McpMemoryRepository, Neo4jTaskRepository, ZepClient   │
│              (src/lib/infrastructure/di/)               │
│   Container, bootstrap, tokens, ServiceFactory          │
└─────────────────────────────────────────────────────────┘
```

### Event-Driven Architecture

Lisa uses an event-driven architecture where CLI lifecycle events trigger handlers:

| Lisa Event | Claude Code Hook | Handler |
|------------|-----------------|---------|
| `session:start` | `SessionStart` | `SessionStartHandler` |
| `session:stop` | `Stop` | `SessionStopHandler` |
| `prompt:submit` | `UserPromptSubmit` | `PromptSubmitHandler` |

### Dependency Injection

Services are resolved via a DI container bootstrapped at startup:

```typescript
const bootstrap = await bootstrapContainer({ projectRoot: process.cwd() });
const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);
const result = await mediator.send(new SessionStartRequest(trigger, timestamp));
await bootstrap.dispose();
```

For CLI-specific services (init, docker, doctor), a separate factory is used:

```typescript
const services = createCliServices(TEMPLATE_ROOT);
await initCommand(opts, services);
```

### Repository Pattern with Routing

The DAL abstracts storage backends behind interfaces with intelligent routing:

```typescript
const memoryRepo = router.getMemoryRepository('search');  // Routes to MCP
const listRepo = router.getMemoryRepository('list');      // Routes to Neo4j
```

## Related Documentation

- [ADR-001: Single Handler Pattern](../adr/ADR-001-single-handler-pattern.md) - Why handlers live in one location
- [Events](./events.md) - Event-driven architecture and hook handlers
- [Getting Started](../getting-started.md) - User-facing documentation
- [Commands Reference](../commands.md) - CLI command documentation
- [Configuration](../configuration.md) - Environment variables and settings
