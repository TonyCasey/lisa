# ADR-001: Single Handler Implementation Pattern

## Status
Accepted

## Date
2025-01-22

## Context

During development of CLI hook integration, a `hooks/` folder was created at
`src/project/.claude/hooks/` containing handler implementations:

- `session-start.ts` with SessionStartHookHandler
- `session-stop.ts` with SessionStopHookHandler  
- `user-prompt-submit.ts` with PromptSubmitHookHandler

These handlers duplicated logic from the canonical Clean Architecture handlers in
`src/lib/application/handlers/`:

- `SessionStartHandler.ts` (full DAL routing, memory loading)
- `SessionStopHandler.ts` (session capture, Graphiti writes)
- `PromptSubmitHandler.ts` (prompt validation, logging)

The hook handlers were created to handle CLI-specific I/O (stdin/stdout) but
ended up reimplementing business logic, context detection, and memory loading
with approximately 2,000 lines of duplicated code.

### Problems Caused

1. **Feature drift**: `SessionStartHandler` gained Neo4j DAL routing;
   the hook version did not.

2. **Double maintenance**: Every feature required changes in two places.

3. **Inconsistent behavior**: CLI hooks and OpenCode plugin behaved differently
   for the same logical operations.

4. **Testing burden**: Two test suites for the same logical behavior.

5. **DI bypass**: Hook handlers created their own services instead of using
   the DI container, leading to inconsistent service lifetimes.

6. **Architecture violation**: Clean Architecture principles were bypassed,
   with presentation-layer code directly implementing application-layer logic.

## Decision

**All event handlers live in `src/lib/application/handlers/`.**

CLI adapters and plugins:
1. Handle I/O concerns (stdin parsing, stdout formatting)
2. Create requests via the Mediator pattern
3. Delegate to canonical handlers
4. Format responses for their specific output needs

I/O utilities live in `src/lib/infrastructure/cli/` and are NOT handlers.

### Handler Structure

```
src/lib/application/handlers/
├── SessionStartHandler.ts      # Canonical session start logic
├── SessionStopHandler.ts       # Canonical session stop logic
├── PromptSubmitHandler.ts      # Canonical prompt handling
└── index.ts                    # Exports

src/lib/infrastructure/cli/
├── io.ts                       # Stdin/stdout utilities
└── index.ts                    # Exports

src/lib/infrastructure/adapters/
├── claude/                     # Claude Code thin adapters
│   ├── session-start.ts        # Reads stdin, calls handler, writes stdout
│   ├── session-stop.ts
│   └── user-prompt-submit.ts
└── opencode/
    └── plugin.ts               # OpenCode plugin using same handlers
```

## Consequences

### Positive
- Single source of truth for business logic
- Consistent behavior across all integrations (Claude Code, OpenCode)
- One test suite per handler
- Proper DI with lifetime management
- Clear separation of concerns (I/O vs business logic)
- Easier to add new CLI integrations

### Negative
- CLI commands have slightly more indirection
- Required refactoring existing hooks folder (~2,000 lines removed)
- Adapters need to handle CLI-specific serialization

### Neutral
- Need architectural tests to enforce this going forward
- Documentation updates for AI coding assistants

## Compliance

This decision is enforced by:

1. **Architectural tests**: `tests/architecture/handler-locations.test.ts`
   - Fails if handlers exist in hooks/ folder
   - Fails if duplicate handler class names exist
   - Fails if handlers exist outside application layer

2. **Pre-commit hook**: Blocks commits adding handler files in forbidden locations

3. **Documentation**: AGENTS.md includes architectural constraints section for AI assistants

## References

- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Mediator Pattern](https://refactoring.guru/design-patterns/mediator)
- `.dev/features/di-fixes.md` - DI refactor implementation plan
- `.dev/features/di-protection.md` - This protection feature plan
