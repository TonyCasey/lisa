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
.lisa/                      # Source of truth (shared)
├── skills/                   # Memory, tasks, lisa, jira, git
├── rules/                    # Coding standards
├── .env                      # Storage configuration

.claude/                      # Claude Code specific
├── hooks/                    # session-start, session-stop, user-prompt-submit
├── settings.json
├── skills -> ../.lisa/skills
└── rules -> ../.lisa/rules

.opencode/                    # OpenCode specific
├── plugin/
│   └── lisa.js               # Bundled plugin
└── skills -> ../.lisa/skills
```

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

### "Reverse Engineering" Development Process

When developing hooks or skills, follow this workflow:

1. **Prototype in Compiled Output** - Edit JS files directly for fast iteration:
   ```bash
   # Edit hooks directly
   code .claude/hooks/session-start.js
   
   # Test manually
   echo '{"trigger":"compact"}' | node .claude/hooks/session-start.js
   ```

2. **Port Back to TypeScript Source** - Once working, move to TypeScript:
   ```
   .claude/hooks/session-start.js  ->  src/project/.claude/hooks/session-start.ts
   .lisa/skills/memory/            ->  src/project/.lisa/skills/memory/
   ```

3. **Build and Verify** - Compile and deploy changes:
   ```bash
   npm run build
   grep "yourFunction" .claude/hooks/session-start.js
   ```

4. **Add Tests** - Create unit tests mirroring source structure:
   ```
   src/project/.claude/hooks/session-start.ts
   tests/unit/src/project/claude/hooks/session-start.test.ts
   ```

5. **Run Full Test Suite** - Validate everything works:
   ```bash
   npm run lint
   npm run test:unit
   npm run build
   ```

### Why This Workflow?

- **Fast iteration**: JS edits take effect immediately without compilation
- **Type safety**: TypeScript source ensures correctness and maintainability
- **Deployability**: `npm run build` deploys to target directories
- **Testability**: TypeScript source can be properly unit tested

### Standard Development Steps

For regular library code (not hooks/skills):

1. **Write code** following TypeScript strict mode
2. **Run lint**: `npm run lint` (fix auto-fixable issues)
3. **Run tests**: `npm run test:unit`
4. **Build**: `npm run build`
5. **Integration tests**: Set up environment and run `npm run test:integration`

## Memory & Skills System

### Lisa - Your Memory Assistant
Address Lisa directly for memory and tasks:
- "hey lisa, show me recent memories"
- "lisa, what do you know about X" 
- "lisa, what tasks are we working on"
- "lisa, remember that we decided to use Y"

### Local Skills (Model-Neutral)
- `lisa` skill: Intelligent routing to memory/tasks
- `memory` skill: Graphiti MCP integration via `scripts/memory.js`
- `tasks` skill: Task management via `scripts/tasks.js`

### Configuration
- **Endpoint**: `GRAPHITI_ENDPOINT` env or `http://localhost:8010/mcp/`
- **Group**: `GRAPHITI_GROUP_ID` env or project name
- **Storage modes**: Local Docker or Zep Cloud

### Cross-Model Compatibility
- Instructions and scripts are model-neutral (Claude, Gemini, Codex)
- Logic lives in JavaScript/TypeScript scripts
- Prompts avoid model-specific role tokens

## Hooks

Hooks run at specific Claude Code lifecycle events:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start.js` | Session start/resume/compact/clear | Load memory context |
| `session-stop.js` | Claude stops responding | Capture work to memory |
| `user-prompt-submit.js` | User submits prompt | Validate and enhance prompts |

Hooks source: `src/project/.claude/hooks/`
Hooks deployed to: `.claude/hooks/`

### Hooks Module Architecture

The hooks are organized into focused modules for testability and maintainability:

```
src/project/.claude/hooks/
├── session-start.ts              # ~170 lines - orchestration only
├── session-stop.ts               # ~150 lines - spawns worker
├── session-stop-worker.ts        # ~320 lines - background processing
├── user-prompt-submit.ts         # ~200 lines - orchestration only
│
└── utils/                        # Hook utilities
    ├── common/                   # Shared utilities
    │   ├── mcp-client.ts         # RPC calls to Graphiti
    │   ├── context.ts            # Repo/branch/user detection
    │   ├── group-id.ts           # Folder metadata, hierarchical groups
    │   ├── transcript-parser.ts  # Parse Claude transcripts
    │   └── complexity-rater.ts   # Rate work complexity (1-5)
    │
    ├── core/                     # Core domain logic
    │   ├── types.ts              # Shared interfaces (IMemoryItem, ITask, etc.)
    │   ├── task-loader.ts        # Task processing from memory nodes
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
3. **Bundle Hooks**: `bundle-hooks.js` - Bundles hooks with dependencies
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
    │   ├── skills/                   # Shared skills
    │   │   ├── common/               # group-id.ts with full functions
    │   │   ├── shared/utils/         # DI-based utilities
    │   │   ├── memory/               # scripts/memory.js
    │   │   ├── tasks/                # scripts/tasks.js
    │   │   ├── lisa/                 # Intelligent router
    │   │   ├── git/                  # PR, CI, version bump
    │   │   ├── jira/                 # Jira REST API
    │   │   ├── init-review/          # Codebase analysis
    │   │   └── prompt/               # Prompt storage
    │   ├── rules/                    # Coding standards
    │   │   ├── shared/               # clean-architecture, code-quality, testing, git
    │   │   └── typescript/           # TS-specific standards
    │   └── docker/                   # docker-compose.graphiti.yml
    ├── .claude/
    │   ├── hooks/                    # Claude Code lifecycle hooks
    │   │   ├── session-start.ts
    │   │   ├── session-stop.ts
    │   │   ├── session-stop-worker.ts
    │   │   ├── user-prompt-submit.ts
    │   │   └── utils/                # Hook utilities
    │   │       ├── common/           # mcp-client, context, group-id
    │   │       ├── core/             # task-loader, rules-loader
    │   │       ├── io/               # output-formatter
    │   │       └── session/          # trigger-handler, plan-mode
    │   └── config.ts
    └── .opencode/
        └── plugin/
            ├── lisa.ts
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

## Development Workflow: "The Reverse Engineer"
When developing hooks or skills, use this workflow to avoid constant compilation wait times:

1.  **Prototype**: Edit the compiled JS files in `.claude/hooks/` or `.lisa/skills/` directly.
2.  **Test**: Trigger the hook manually (e.g., `echo '{"trigger":"startup"}' | node .claude/hooks/session-start.js`).
3.  **Port**: Move your working logic back to the corresponding `.ts` file in `src/project/`.
4.  **Verify**: Run `npm run build` to re-deploy and ensure your changes persist.
5.  **Test**: Add a unit test in `tests/unit/` mirroring the source path.

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
- **Manual Hook Test**: `node --import tsx --test tests/unit/src/project/claude/hooks/session-start.test.ts`

### Environment
- **Local Graphiti**: `docker compose -f .lisa/docker-compose.graphiti.yml up -d`
- **Memory Milestone**: `lisa memory add "FEATURE: Done" --type milestone`

---

## Available Skills & Hooks

| Type | Name | Purpose |
|------|------|---------|
| **Hook** | `session-start` | Loads memory, tasks, and rules into context. |
| **Hook** | `session-stop` | Spawns background worker to capture work. |
| **Skill** | `/lisa` | Main router for memory/task queries. |
| **Skill** | `/memory` | Direct interaction with the knowledge graph. |
| **Skill** | `/tasks` | CRUD operations for project tasks. |
