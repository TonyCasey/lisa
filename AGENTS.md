# Lisa Development Guide

## Multi-CLI Architecture

Lisa supports multiple AI coding assistants through a unified, event-driven architecture:

### Supported CLIs

| CLI Tool | Integration | Directory | Status |
|----------|-------------|-----------|--------|
| **Claude Code** | Lifecycle hooks | `.claude/` | Stable |
| **OpenCode** | Plugin system | `.opencode/` | Stable |

### Shared Resources

Both CLIs share resources from `.lisa/`:

```
.lisa/                        # Source of truth (shared)
├── skills/                   # Memory, tasks, lisa, jira, git
├── rules/                    # Coding standards
├── .env                      # Storage configuration

.claude/                      # Claude Code specific
├── settings.json             # Hook commands registered here
├── skills/
│   └── lisa/ -> ../../.lisa/skills  # Subdirectory symlink
└── rules/
    └── lisa/ -> ../../.lisa/rules   # Subdirectory symlink

.opencode/                    # OpenCode specific
├── plugin/
│   └── lisa.js               # Bundled plugin
└── skills/
    ├── memory/ -> ../../.lisa/skills/memory
    ├── tasks/ -> ../../.lisa/skills/tasks
    └── ...                   # Individual skill symlinks
```

**Note:** Lisa uses subdirectory symlinks to preserve any existing user files in `.claude/` or `.opencode/`.

### Event Mapping

Lisa events map to CLI-specific lifecycle hooks:

| Lisa Event | Claude Code | OpenCode |
|------------|-------------|----------|
| `session:start` (startup) | `SessionStart` trigger=startup | `session.created` |
| `session:start` (resume) | `SessionStart` trigger=resume | `session.updated` |
| `session:start` (compact) | `SessionStart` trigger=compact | `session.compacted` |
| `session:stop` (idle) | `Stop` | `session.idle` |
| `prompt:submit` | `UserPromptSubmit` | `message.updated` |

### CLI Selection

During `lisa init`, users can select which CLIs to support:

```bash
# Interactive (prompts for selection)
lisa init

# Non-interactive
lisa init --claude-only      # Only Claude Code
lisa init --opencode-only    # Only OpenCode
lisa init -y                 # Both (default)
```

---

## Core Library Development

### Where to Write Code

**All core library code lives in `src/lib/`**. This is the source of truth for:
- CLI commands (`cli.ts`)
- Domain interfaces and types (`domain/`)
- Infrastructure implementations (`infrastructure/`)
- Application handlers (`application/`)
- Service factories and DI (`services.ts`)

The `src/project/` directory contains **templates only** - hooks and skills that get deployed to destination projects. These are not core library code.

### Installation Model

Lisa is installed as a **global npm package** in destination projects:

```bash
# Global installation
npm install -g @tonycasey/lisa

# Initialize in a project
cd /path/to/your/project
lisa init
```

When `lisa init` runs, it:
1. Copies templates from the installed package to the project
2. Creates `.lisa/`, `.claude/`, and/or `.opencode/` directories
3. Sets up symlinks for shared resources
4. Configures storage backend (Local Docker or Zep Cloud)

The core library code (`dist/lib/`) remains in global `node_modules` and is invoked via the `lisa` CLI command.

### Clean Architecture

Lisa follows **Clean Architecture** principles with clear layer separation:

```
┌─────────────────────────────────────────────────────────┐
│                    CLI / Presentation                    │
│                      (src/lib/cli.ts)                   │
├─────────────────────────────────────────────────────────┤
│                     Application Layer                    │
│            (src/lib/application/handlers/)              │
│   SessionStartHandler, SessionStopHandler, etc.         │
├─────────────────────────────────────────────────────────┤
│                      Domain Layer                        │
│              (src/lib/domain/interfaces/)               │
│   IMemoryRepository, ITaskRepository, IMemoryItem, etc. │
├─────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                   │
│              (src/lib/infrastructure/dal/)              │
│   McpMemoryRepository, Neo4jTaskRepository, ZepClient   │
└─────────────────────────────────────────────────────────┘
```

**Key principles:**
- **Domain layer has no dependencies** on infrastructure or application
- **Application layer** depends only on domain interfaces
- **Infrastructure layer** implements domain interfaces
- **Dependency inversion** via constructor injection

### Event-Driven Architecture

Lisa uses an **event-driven architecture** where CLI lifecycle events trigger handlers:

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  CLI Event   │ ──> │  Event Handler  │ ──> │  Domain Services │
│  (Hook)      │     │  (Application)  │     │  (Infrastructure)│
└──────────────┘     └─────────────────┘     └──────────────────┘
```

**Event flow:**
1. **Claude Code/OpenCode** triggers a lifecycle event (session start, stop, prompt submit)
2. **Hooks** (in `.claude/hooks/` or `.opencode/plugin/`) receive the event
3. **Handlers** in `src/lib/application/handlers/` process the event
4. **Services** in `src/lib/infrastructure/services/` execute domain logic
5. **Repositories** in `src/lib/infrastructure/dal/` persist/retrieve data

**Lisa events:**
| Event | Trigger | Handler |
|-------|---------|---------|
| `session:start` | New/resume/compact session | `SessionStartHandler` |
| `session:stop` | Claude stops responding | `SessionStopHandler` |
| `prompt:submit` | User submits prompt | `PromptSubmitHandler` |

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Presentation** | `src/lib/cli.ts` | CLI commands, argument parsing |
| **Application** | `src/lib/application/` | Use cases, event handlers, orchestration |
| **Domain** | `src/lib/domain/` | Interfaces, types, domain errors |
| **Infrastructure** | `src/lib/infrastructure/` | DAL, adapters, external services |

### Adding New Features

When adding a new feature to the core library:

1. **Define domain interface** in `src/lib/domain/interfaces/`
2. **Create application handler** in `src/lib/application/handlers/`
3. **Implement infrastructure** in `src/lib/infrastructure/`
4. **Wire up DI** in `src/lib/services.ts` or `infrastructure/di/`
5. **Add CLI command** in `src/lib/cli.ts` if needed
6. **Write tests** mirroring the source structure

---

## Build Commands

### Core Commands
```bash
npm run build              # Compile TypeScript to dist/
npm run clean              # Remove dist/ directory
npm run lint               # ESLint check
npm run test               # Run all unit tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests (requires setup)
npm run package            # Create npm package in releases/
```

### Single Test Execution
```bash
# Run specific unit test file
node --import tsx --test tests/unit/src/cli.test.ts

# Run specific integration test
tsx --test tests/integration/memory/index.ts
tsx --test tests/integration/tasks/index.ts
```

### Integration Testing
Integration tests require environment setup:
```bash
# Memory integration tests (Zep Cloud)
RUN_MEMORY_INTEGRATION_TESTS=1 STORAGE_MODE=zep-cloud npm run test:integration:memory

# Tasks integration tests (Zep Cloud)  
RUN_TASKS_INTEGRATION_TESTS=1 STORAGE_MODE=zep-cloud npm run test:integration:tasks

# Local MCP mode (requires Docker)
docker compose -f .lisa/docker-compose.graphiti.yml up -d
RUN_MEMORY_INTEGRATION_TESTS=1 STORAGE_MODE=local npm run test:integration:memory
```

## Code Style Guidelines

### TypeScript Configuration
- **Target**: ES2021, CommonJS modules
- **Strict mode**: Enabled (`strict: true`)
- **Null checks**: Strict null checking enforced
- **No implicit any**: All types must be explicit

### Import Organization
```typescript
// 1. Node.js built-ins
import fs from 'fs-extra';
import path from 'path';

// 2. Third-party dependencies  
import { Command } from 'commander';
import chalk from 'chalk';

// 3. Internal modules (relative imports)
import { createDefaultServices } from './services';
import { IScanOptions } from './scanner';
```

### Naming Conventions
- **Interfaces**: Prefix with `I` (e.g., `IMcpClient`, `IServices`)
- **Classes**: PascalCase (e.g., `DefaultTemplateCopier`)
- **Functions/Variables**: camelCase (e.g., `createDefaultServices`, `templateRoot`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_ENDPOINT`, `TEMPLATE_ROOT`)
- **Files**: Match primary export (e.g., `IServices.ts` exports `IServices`)

### Type Safety Rules
- **NEVER** use `any` type - use `unknown` or specific interfaces
- **ALWAYS** specify return types for public functions
- **ALWAYS** handle potentially undefined/null values
- **USE** optional chaining (`?.`) and nullish coalescing (`??`)

### Error Handling
```typescript
// Domain errors with context
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Proper async error handling
async function fetchData(id: string): Promise<Data> {
  try {
    const result = await repository.getById(id);
    if (!result) {
      throw new NotFoundError(`Data not found: ${id}`);
    }
    return result;
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error; // Re-throw domain errors
    }
    // Transform unknown errors
    throw new ServiceError('Failed to fetch data', { originalError: error });
  }
}
```

### Constructor Injection
```typescript
export class Service implements IService {
  constructor(
    private readonly repository: IRepository,
    private readonly logger: ILogger
  ) {}
  
  // Dependencies are readonly and injected via constructor
}
```

### Architectural Constraints

#### Single Source of Truth for Handlers
- **All event handlers** live in `src/lib/application/handlers/`
- **NEVER** create parallel implementations (e.g., `hooks/` folder with duplicate handlers)
- CLI commands, plugins, and adapters MUST use canonical handlers via DI/Mediator
- If a handler needs CLI-specific I/O, add utilities to `src/lib/infrastructure/cli/`

#### Why This Matters
We previously had duplicate handlers in a `hooks/` folder that bypassed Clean Architecture.
This led to feature drift, double maintenance, and inconsistent behavior between CLI and plugins.
See `docs/adr/ADR-001-single-handler-pattern.md` for the full decision record.

#### Enforcement
This constraint is enforced by:
1. `tests/architecture/handler-locations.test.ts` - Fails if handlers exist outside canonical locations
2. Pre-commit hook checking for forbidden patterns
3. This documentation for AI coding assistants

### File Organization
- **One interface per file** (except small related types)
- **Index files** for clean imports in directories
- **Templates** in `src/project/` with clear structure
- **Tests** mirror source structure in `tests/unit/`

### ESLint Rules
Key rules enforced:
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/no-unused-vars`: warn (with `_` prefix allowed)
- `no-console`: off (CLI tool)
- `@typescript-eslint/no-var-requires`: off (CommonJS)

### Testing Principles
- **Unit tests**: Fast, isolated, mock dependencies
- **Integration tests**: Real backends, test contracts
- **Arrange-Act-Assert** pattern
- **Test behavior, not implementation**
- **Meaningful test names**: `method_givenCondition_shouldExpectedOutcome`

### Async Patterns
```typescript
// GOOD - async/await
async function processItems(items: Item[]): Promise<Result[]> {
  const results = await Promise.all(
    items.map(item => processItem(item))
  );
  return results;
}

// BAD - raw promises
function processItems(items: Item[]): Promise<Result[]> {
  return Promise.all(items.map(processItem));
}
```

## Project Structure

```
lisa/
├── src/
│   ├── lib/                          # Core library code
│   │   ├── cli.ts                    # Main CLI entry point (Commander.js)
│   │   ├── services.ts               # Service factory with DI
│   │   ├── mcp.ts                    # MCP client (JSON-RPC 2.0)
│   │   ├── scanner/                  # Multi-project scanner
│   │   ├── interfaces/               # CLI service interfaces
│   │   ├── domain/                   # Domain types and contracts
│   │   │   ├── interfaces/           # Repository interfaces, types
│   │   │   └── types/                # Core types (IMemoryItem, ITask)
│   │   ├── infrastructure/           # Infrastructure layer
│   │   │   └── dal/                  # Data Access Layer (multi-backend)
│   │   └── application/              # Use cases
│   └── project/                      # Templates (mirrors deployment structure)
│       ├── .lisa/
│       │   ├── skills/               # Memory, tasks, lisa, jira, git
│       │   │   ├── common/           # Shared group-id.ts with TYPE_MAP, PREFIX_MAP
│       │   │   ├── shared/utils/     # DI-based utilities (simplified)
│       │   │   ├── memory/
│       │   │   ├── tasks/
│       │   │   └── ...
│       │   ├── rules/                # Coding standards
│       │   │   ├── shared/           # clean-architecture, code-quality, testing, git
│       │   │   └── typescript/       # TS-specific standards
│       │   └── docker/               # docker-compose.graphiti.yml
│       ├── .claude/
│       │   ├── hooks/                # Claude Code lifecycle hooks
│       │   │   ├── session-start.ts
│       │   │   ├── session-stop.ts
│       │   │   ├── session-stop-worker.ts
│       │   │   ├── user-prompt-submit.ts
│       │   │   └── utils/            # Hook utilities
│       │   │       ├── common/       # mcp-client, context, group-id, transcript-parser
│       │   │       ├── core/         # task-loader, memory-loader, rules-loader
│       │   │       ├── io/           # output-formatter, stdin-reader
│       │   │       └── session/      # trigger-handler, plan-mode
│       │   └── config.ts
│       └── .opencode/
│           └── plugin/
│               ├── lisa.ts           # OpenCode plugin source
│               └── opencode-events.ts
├── .claude/                          # Deployed hooks (compiled output)
│   ├── hooks/                        # Bundled JS hooks
│   ├── skills -> ../.lisa/skills     # Symlink to shared skills
│   └── rules -> ../.lisa/rules       # Symlink to shared rules
├── .opencode/                        # Deployed OpenCode plugin
│   ├── plugin/
│   │   └── lisa.js                   # Bundled plugin
│   └── skills -> ../.lisa/skills
├── .lisa/                            # Deployed skills and rules (shared)
│   ├── skills/
│   ├── rules/
│   ├── docker/
├── tests/
│   ├── unit/                         # Unit tests (mirror src/ structure)
│   ├── integration/                  # Integration tests
│   └── e2e/                          # End-to-end tests
└── dist/                             # Compiled library output
    ├── lib/                          # Compiled CLI and library
    └── project/                      # Compiled deployables
```

**Key Development Paths:**
- **Hooks/Skills Development**: `src/project/` -> prototype in `.claude/` or `.lisa/` -> port back to TypeScript
- **Library Code**: Edit directly in `src/lib/` -> `npm run build` -> `dist/lib/`
- **Tests**: Mirror source structure in `tests/unit/`

## Development Workflow

### Standard Development Steps

For library code (CLI commands, handlers, skills):

1. **Write code** following TypeScript strict mode in `src/lib/`
2. **Run lint**: `npm run lint` (fix auto-fixable issues)
3. **Run tests**: `npm run test:unit`
4. **Build**: `npm run build`
5. **Integration tests**: Set up environment and run `npm run test:integration`

### Testing Hook Handlers

Hook handlers can be tested directly via CLI:

```bash
# Test session-start hook
echo '{"source":"startup"}' | lisa hook session-start

# Test session-stop hook  
echo '{"session_id":"test"}' | lisa hook session-stop

# Test user-prompt-submit hook
echo '{"prompt":"test"}' | lisa hook user-prompt-submit
```

### Adding New Hook Logic

1. **Edit handler** in `src/lib/application/handlers/hooks/<Handler>.ts`
2. **Add tests** in `tests/unit/src/lib/application/handlers/hooks/<Handler>.test.ts`
3. **Run tests**: `npm run test:unit`
4. **Build**: `npm run build`

## Memory & Skills System

### Lisa - Your Memory Assistant
Address Lisa directly for memory and tasks:
- "hey lisa, show me recent memories"
- "lisa, what do you know about X" 
- "lisa, what tasks are we working on"
- "lisa, remember that we decided to use Y"

### Local Skills (Model-Neutral)
- `lisa` skill: Intelligent routing to memory/tasks
- `memory` skill: Graphiti MCP integration via `lisa memory` CLI
- `tasks` skill: Task management via `lisa tasks` CLI

### Configuration
- **Endpoint**: `GRAPHITI_ENDPOINT` env or `http://localhost:8010/mcp/`
- **Group**: Automatically derived from project folder path
- **Storage modes**: Local Docker or Zep Cloud

### Cross-Model Compatibility
- Instructions and scripts are model-neutral (Claude, Gemini, Codex)
- Logic lives in JavaScript/TypeScript scripts
- Prompts avoid model-specific role tokens

## Hooks

Hooks run at specific Claude Code lifecycle events via CLI commands:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `lisa hook session-start` | Session start/resume/compact/clear | Load memory context |
| `lisa hook session-stop` | Claude stops responding | Capture work to memory |
| `lisa hook user-prompt-submit` | User submits prompt | Validate and enhance prompts |

Hooks are registered in `.claude/settings.json` and invoked as CLI commands.
Hook handlers source: `src/lib/application/handlers/hooks/`

### Hooks Architecture

Hooks are implemented as CLI command handlers in the application layer:

```
src/lib/application/handlers/hooks/
├── SessionStartHookHandler.ts    # Load memory context
├── SessionStopHookHandler.ts     # Capture work (spawns background worker)
├── UserPromptSubmitHookHandler.ts # Validate and log prompts
├── types.ts                      # Input/output type definitions
├── utils.ts                      # Stdin/stdout helpers, env config
└── index.ts                      # Exports
    │   ├── memory-loader.ts      # Load memories from MCP/Zep
    │   └── rules-loader.ts       # Load project rules
    │
    ├── io/                       # I/O operations
    │   ├── stdin-reader.ts       # Read JSON from stdin with timeout
    │   ├── output-formatter.ts   # Format memory/task output
    │   └── graphiti-writer.ts    # Write to Graphiti (sync/async)
    │
    └── session/                  # Session-specific logic
        ├── trigger-handler.ts    # Handle startup/resume/compact/clear
        └── plan-mode.ts          # Plan mode state management
```

### SessionStart Trigger Types

The session-start hook handles different triggers with appropriate messaging:

| Trigger | When | Message |
|---------|------|---------|
| `startup` | Initial session | "Memory loaded for session start" |
| `resume` | Resuming session | "Memory loaded for session resume" |
| `compact` | After auto-compact | "Memory reloaded after context compaction" + skills reminder |
| `clear` | After /clear | "Memory loaded after context clear" + fresh start reminder |

## Available Skills

Skills are invoked with `/skill-name` in Claude Code:

| Skill | Description | Trigger |
|-------|-------------|---------|
| `/memory` | Load or remember project memory | "load memory", "recall", "remember" |
| `/tasks` | Create, load, or summarize tasks | "tasks", "list tasks", "add task" |
| `/lisa` | Intelligent assistant for memory and tasks | "lisa", "hey lisa" |
| `/jira` | Create and manage Jira issues | "jira", "create ticket" |
| `/git` | GitHub and Git workflow helpers | "create pr", "pr checks" |
| `/init-review` | Initial codebase review and summary | First session in a repo |

Skills source: `src/project/.lisa/skills/`
Skills deployed to: `.lisa/skills/`

## Build Process

`npm run build` does:

1. **Compile**: `tsc -p tsconfig.json` - Compiles TypeScript to `dist/`
2. **Prepare Package**: `prepare-dist-package.js` - Prepares for npm publish
3. **Bundle Hooks**: `bundle-opencode.js` - Bundles OpenCode plugin with dependencies
4. **Deploy Locally**: `deploy-lisa.js` - Deploys to `.claude/`, `.lisa/`, `.opencode/`

## Memory System

Lisa uses Graphiti (knowledge graph) for persistent memory:

- **Facts**: Discrete pieces of information about the project
- **Nodes**: Entities in the knowledge graph
- **Tasks**: Tracked work items with status

Memory is stored per-repo and accessed via MCP (Model Context Protocol).

## Git Workflow

After committing, save a milestone memory:

```bash
lisa memory add "FEATURE: Description of what was done" --cache --type milestone
```

This ensures work is captured for future sessions.

---

## Codebase Architecture Overview

### What Lisa Does

Lisa is a TypeScript CLI tool that provides **persistent memory and task management** for AI coding assistants. It uses Graphiti (a knowledge graph built on Neo4j) via MCP (Model Context Protocol) to store and retrieve memories, tasks, and project context across sessions.

> **Note**: For architectural principles (Clean Architecture, Event-Driven Architecture, layer responsibilities), see the [Core Library Development](#core-library-development) section above.

### Source Code Organization

```
src/
├── lib/                              # Core library code
│   ├── cli.ts                        # Main CLI entry point (Commander.js)
│   ├── services.ts                   # Service factory with DI
│   ├── mcp.ts                        # MCP client (JSON-RPC 2.0)
│   ├── scanner/                      # Multi-project scanner
│   │   ├── index.ts                  # Orchestration
│   │   ├── discovery.ts              # Project detection (npm, python, rust, go)
│   │   ├── reviewer.ts               # Runs init-review per project
│   │   ├── analyzer.ts               # Cross-repo relationship analysis
│   │   └── facts.ts                  # Fact generation and storage
│   ├── interfaces/                   # CLI service interfaces
│   │   ├── IServices.ts              # Aggregates all services
│   │   ├── ITemplateCopier.ts        # Template deployment
│   │   ├── IDockerClient.ts          # Docker/Compose operations
│   │   └── IMcpClient.ts             # MCP health checks
│   ├── domain/                       # Domain types and contracts
│   │   ├── interfaces/               # Repository interfaces
│   │   │   ├── dal/                  # IMemoryRepository, ITaskRepository
│   │   │   └── types/                # Core types
│   │   └── events/                   # Event interfaces
│   ├── infrastructure/               # Infrastructure layer
│   │   └── dal/                      # Data Access Layer
│   │       ├── RepositoryFactory.ts
│   │       ├── routing/              # RepositoryRouter
│   │       ├── connections/          # Connection managers
│   │       └── repositories/         # MCP, Neo4j, Zep implementations
│   └── application/                  # Use cases
└── project/                          # Templates (mirrors deployment)
    ├── .lisa/
    │   ├── skills/                   # Shared skills (SKILL.md files only)
    │   │   ├── memory/               # SKILL.md for memory
    │   │   ├── tasks/                # SKILL.md for tasks
    │   │   ├── lisa/                 # Intelligent router
    │   │   ├── git/                  # PR, CI, version bump
    │   │   ├── jira/                 # Jira REST API
    │   │   ├── init-review/          # Codebase analysis
    │   │   └── prompt/               # Prompt storage
    │   ├── rules/                    # Coding standards
    │   │   ├── shared/               # clean-architecture, code-quality, testing, git
    │   │   └── typescript/           # TS-specific standards
    │   └── docker/                   # docker-compose.graphiti.yml
    └── .opencode/
        └── plugin/
            ├── lisa.ts               # OpenCode plugin source
            └── opencode-events.ts
```

### Data Access Layer Architecture

The DAL uses a multi-backend routing pattern:

```
RepositoryFactory
    └── creates -> RepositoryRouter
                      ├── MCP Repositories    (semantic search, writes)
                      ├── Neo4j Repositories  (date-ordered, aggregation)
                      └── Zep Repositories    (cloud-hosted)
```

**Routing Logic:**
- `list` operations -> prefer Neo4j (efficient date ordering)
- `search` operations -> prefer MCP (semantic search)
- `write` operations -> prefer MCP (authoritative)
- `aggregate` operations -> prefer Neo4j (efficient grouping)

### Key Domain Types

```typescript
interface IMemoryItem {
  uuid: string;
  name: string;
  fact: string;
  tags?: string[];
  created_at: string;
}

interface ITask {
  key: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  blocked_by?: string[];
  created_at: string;
}

interface IQueryOptions {
  query?: string;
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
  tags?: string[];
  since?: string;
  until?: string;
}

type BackendSource = 'mcp' | 'neo4j' | 'zep';
```

### Storage Modes

| Mode | Backend | Requirements |
|------|---------|--------------|
| **Local** | Neo4j + Graphiti MCP (Docker) | Docker Desktop |
| **Zep Cloud** | Managed Zep service | API key, Project ID |
| **Skip** | Configure later | None (deferred) |

### Design Patterns Used

1. **Dependency Injection** - Services created via `createDefaultServices()` factory
2. **Repository Pattern** - DAL abstracts storage backends behind interfaces
3. **Strategy Pattern** - Router selects optimal backend per operation type
4. **Event-Driven** - Hooks respond to CLI lifecycle events
5. **Template Method** - Hooks share common utilities from `hooks/utils/`
6. **Clean Architecture** - Domain interfaces separate from infrastructure implementations

---

## Code Style & Engineering Standards

### TypeScript & DI
- **Interfaces**: Prefix with `I` (e.g., `IMemoryItem`).
- **DI**: Use constructor injection. Services are managed via `src/lib/services.ts`.
- **Safety**: `strict: true` is enabled. Use `unknown` over `any`.

### Data Access Layer (DAL)
The DAL uses a **Strategy Pattern** to route operations:
- **Search**: Routes to **MCP** (Semantic search).
- **List/Aggregate**: Routes to **Neo4j** (Efficient ordering/grouping).
- **Cloud**: Routes to **Zep** (If configured).

---

## Commands Reference

### Build & Deploy
- `npm run build`: Compiles TS and deploys to `.claude/` and `.lisa/`.
- `npm run clean`: Wipes `dist/`.

### Testing
- `npm test`: Runs all unit tests.
- `npm run test:unit`: Fast isolated tests.
- `npm run test:integration`: Integration tests (requires Docker/Zep).
- **Manual Hook Test**: `echo '{"source":"startup"}' | lisa hook session-start`

### Environment
- **Local Graphiti**: `docker compose -f .lisa/docker-compose.graphiti.yml up -d`
- **Memory Milestone**: `lisa memory add "FEATURE: Done" --type milestone`

---

## Available Skills & Hooks

| Type | Name | Purpose |
|------|------|---------|
| **Hook** | `lisa hook session-start` | Loads memory, tasks, and rules into context. |
| **Hook** | `lisa hook session-stop` | Spawns background worker to capture work. |
| **Hook** | `lisa hook user-prompt-submit` | Validates and logs prompts. |
| **Skill** | `/lisa` | Main router for memory/task queries. |
| **Skill** | `/memory` | Direct interaction with the knowledge graph. |
| **Skill** | `/tasks` | CRUD operations for project tasks. |
