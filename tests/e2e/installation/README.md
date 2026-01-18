# Installation Tests

Tests for verifying lisa package installation and functionality across different environments.

## Test Methods

### Docker (Linux Distributions)

Located in `docker/` - tests package installation across:
- Ubuntu 22.04
- Debian Bookworm
- Alpine Linux
- Fedora 40

**Two modes:**
- **Quick Mode**: Installation verification only
- **Full Mode**: Installation + Memory persistence with Neo4j + Graphiti MCP

**CLI variants:**
- `both`: Test Claude Code + OpenCode (default)
- `claude-only`: Test Claude Code integration only
- `opencode-only`: Test OpenCode integration only

See `docker/README.md` for detailed usage.

### Quick Start

```bash
# From project root

# 1. Build and package
npm run build && npm run package

# 2. Run quick installation tests (default: both CLIs)
npm run test:install:quick

# 3. Run full tests with memory persistence (requires OPENAI_API_KEY in .env)
npm run test:install:full
```

### CLI-Specific Testing

```bash
# Test Claude Code only
npm run test:install:quick:claude
npm run test:install:full:claude

# Test OpenCode only
npm run test:install:quick:opencode
npm run test:install:full:opencode
```

### Windows

Native testing on Windows is done manually or via the unit/integration tests.

```bash
# Unit tests
npm run test:unit

# CLI integration tests
npx cross-env RUN_CLI_INTEGRATION_TESTS=1 npm run test:integration:cli

# E2E hook tests
npx cross-env RUN_E2E_HOOK_TESTS=1 npm run test:e2e:hooks
```

### macOS

Not supported via Docker (Apple licensing). Use VM or real hardware with same commands as Windows.

## Test Coverage

| Test Type | What's Tested | Location |
|-----------|--------------|----------|
| Unit | Core library functions | `tests/unit/` |
| Integration | CLI commands, DAL backends | `tests/integration/` |
| E2E Hooks | Hook execution on real filesystem | `tests/e2e/hooks/` |
| E2E Install | Full package installation on Linux | `tests/e2e/installation/` |
