# Tests

This directory contains all tests for the lisa project, organized according to testing principles.

## Directory Structure

```
tests/
├── unit/                           # Unit tests (pure functions, no I/O)
│   └── src/
│       ├── cli.test.ts
│       └── project/                # Tests for src/project/
│           ├── claude/hooks/
│           └── lisa/skills/
├── integration/                    # Integration tests (real backends)
│   ├── shared/                     # Shared test utilities
│   │   ├── cli-runner.ts           # CLI execution helper
│   │   ├── types.ts                # Shared type definitions
│   │   └── sample-projects/        # Multi-language sample projects
│   ├── memory/                     # Memory skill integration tests
│   │   ├── index.ts                # Test suite
│   │   └── memory-cli-client.ts    # Memory CLI client helper
│   └── tasks/                      # Tasks skill integration tests
│       ├── index.ts                # Test suite
│       └── tasks-cli-client.ts     # Tasks CLI client helper
├── e2e/                            # End-to-end dockerized suites
│   └── deploy/                     # Multi-OS Docker workflows
└── plans/                          # Test plan documentation
```

## Test Types

### Unit Tests (`unit/`)

Fast, isolated tests for pure functions and data structures. No external dependencies.

```bash
npm run test:unit
```

### Integration Tests (`integration/`)

Tests that verify skills can read/write to real backends (local MCP or Zep Cloud).

```bash
npm run test:integration
npm run test:integration:memory
npm run test:integration:tasks
```

### End-to-End Tests (`e2e/`)

High-fidelity scenarios that spin up dedicated Docker environments.

```bash
npm run e2e:docker:quick
npm run e2e:docker:full
```

## Running Integration Tests

Integration tests verify SKILL.md I/O contracts and database persistence. They support two backends:

- **Local MCP**: Requires Docker with Graphiti running
- **Zep Cloud**: Requires `ZEP_API_KEY` in root `.env` (no Docker needed)

### Prerequisites

1. **Build the project** (scripts must exist):
   ```bash
   npm run build
   ```

2. **For Zep Cloud mode**: Ensure root `.env` contains:
   ```
   ZEP_API_KEY=<your-zep-api-key>
   ```

3. **For Local MCP mode**: Start Graphiti stack:
   ```bash
   docker compose -f .lisa/docker-compose.graphiti.yml up -d
   ```

### Memory Integration Tests

Tests the memory skill I/O contracts (add, load, tags, isolation).

**PowerShell (Zep Cloud):**
```powershell
$env:RUN_MEMORY_INTEGRATION_TESTS = '1'
$env:STORAGE_MODE = 'zep-cloud'
npm run test:integration:memory
```

**Bash (Zep Cloud):**
```bash
RUN_MEMORY_INTEGRATION_TESTS=1 STORAGE_MODE=zep-cloud npm run test:integration:memory
```

**Local MCP:**
```powershell
$env:RUN_MEMORY_INTEGRATION_TESTS = '1'
$env:STORAGE_MODE = 'local'
npm run test:integration:memory
```

### Tasks Integration Tests

Tests the tasks skill I/O contracts (add, list, statuses, isolation).

**PowerShell (Zep Cloud):**
```powershell
$env:RUN_TASKS_INTEGRATION_TESTS = '1'
$env:STORAGE_MODE = 'zep-cloud'
npm run test:integration:tasks
```

**Bash (Zep Cloud):**
```bash
RUN_TASKS_INTEGRATION_TESTS=1 STORAGE_MODE=zep-cloud npm run test:integration:tasks
```

### Run All Integration Tests

```powershell
$env:RUN_MEMORY_INTEGRATION_TESTS = '1'
$env:RUN_TASKS_INTEGRATION_TESTS = '1'
$env:STORAGE_MODE = 'zep-cloud'
npm run test:integration
```

### Environment Variables

| Variable | Required | Source | Description |
|----------|----------|--------|-------------|
| `RUN_MEMORY_INTEGRATION_TESTS` | Yes | Shell | Set to `1` to enable memory tests |
| `RUN_TASKS_INTEGRATION_TESTS` | Yes | Shell | Set to `1` to enable tasks tests |
| `STORAGE_MODE` | Yes | Shell | `local` (MCP) or `zep-cloud` |
| `ZEP_API_KEY` | Zep only | Root `.env` | Zep Cloud API key (auto-loaded) |
| `MEMORY_TEST_GROUP_ID` | No | Shell | Custom group ID for memory tests |
| `TASKS_TEST_GROUP_ID` | No | Shell | Custom group ID for tasks tests |
| `MEMORY_TEST_ENDPOINT` | No | Shell | Custom MCP endpoint override |
| `TASKS_TEST_ENDPOINT` | No | Shell | Custom MCP endpoint override |

### Test Coverage

Tests verify:

1. **I/O Contract Validation** - Response shapes match SKILL.md documentation
2. **Persistence** - Data survives add/load or add/list cycles
3. **Group Isolation** - Data doesn't leak between groups
4. **Tags** - Explicit tags preserved, prefix auto-detection works
5. **Status** (tasks) - All statuses (todo, doing, done) work correctly

## Docker Deployment Tests

### Quick Mode (No API Keys)

```bash
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages
npm run e2e:docker:quick
```

### Full Mode (Requires OPENAI_API_KEY)

```bash
npm run e2e:docker:full
```

See `plans/deploy-docker.md` for comprehensive Docker testing procedures.

## Windows Deployment Tests

See `plans/deploy-windows.md` for manual testing procedures.
