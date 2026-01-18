# Docker Installation Tests

Test lisa package installation and memory persistence across multiple Linux distributions.

## Two Testing Modes

### Quick Mode (Installation Only)
Tests package installation without memory persistence. No API key required.

```bash
# From project root
npm run build && npm run package
npm run test:install:quick
```

### Full Mode (Installation + Memory Persistence)
Tests complete integration with Neo4j + Graphiti. Requires OPENAI_API_KEY in root `.env`.

```bash
# From project root (ensure .env has OPENAI_API_KEY)
npm run build && npm run package
npm run test:install:full
```

## CLI Mode Variants

Lisa supports multiple AI coding assistants. You can test specific CLI configurations:

| Mode | Description | Flag |
|------|-------------|------|
| `both` | Both Claude Code and OpenCode (default) | None |
| `claude-only` | Only Claude Code integration | `--claude-only` |
| `opencode-only` | Only OpenCode integration | `--opencode-only` |

### Quick Mode with CLI variants
```bash
# Test both CLIs (default)
npm run test:install:quick

# Test Claude Code only
npm run test:install:quick:claude

# Test OpenCode only
npm run test:install:quick:opencode

# Or use environment variable directly
CLI_MODE=claude-only docker compose up --build
```

### Full Mode with CLI variants
```bash
# Test both CLIs (default)
npm run test:install:full

# Test Claude Code only
npm run test:install:full:claude

# Test OpenCode only
npm run test:install:full:opencode

# Or use environment variable directly
CLI_MODE=opencode-only docker compose --env-file ../../../../.env -f docker-compose.test.yml up --build
```

### Test All Distributions
```bash
# Quick mode - all distros
docker compose --profile all up --build

# Full mode - all distros
docker compose --env-file ../../../../.env -f docker-compose.test.yml --profile all up --build
```

## Test Results

| OS | Quick Mode | Full Mode |
|----|-----------|-----------|
| Ubuntu 22.04 | 11/11 PASS | Pending |
| Debian Bookworm | 11/11 PASS | Pending |
| Alpine 3.20 | 10/11 (CLI issue) | Pending |
| Fedora 40 | 11/11 PASS | Pending |

## What's Tested

### Quick Mode (verify-installation.sh)
- Lisa CLI accessible and shows version
- `.lisa/` folder created with skills and rules
- Memory, tasks, and lisa skills present
- Configuration file created

**CLI-specific checks:**
- Claude Code: `.claude/` folder, hooks, settings.json, symlinks
- OpenCode: `.opencode/` folder, plugin, symlinks
- Configuration validation (correct CLIs listed)

### Full Mode (test-memory-persistence.sh)
- Add memory fact via CLI
- Retrieve memory via search
- Memory persists across sessions
- Session hook integration

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Quick mode - installation tests only |
| `docker-compose.test.yml` | Full mode - includes Neo4j + Graphiti |
| `Dockerfile.*` | OS-specific Docker images |
| `scripts/run-tests.sh` | Quick mode test runner |
| `scripts/run-full-tests.sh` | Full mode test runner |
| `scripts/verify-installation.sh` | Installation checks |
| `scripts/test-memory-persistence.sh` | Memory persistence checks |
| `scripts/setup-project.sh` | Create sample projects |

## Environment Requirements

### Quick Mode
- Docker Desktop running
- Built package (.tgz) in `releases/` folder

### Full Mode
- Docker Desktop running
- Built package (.tgz) in `releases/` folder
- Root `.env` file with:
  - `OPENAI_API_KEY` (required)
  - `NEO4J_USER` (default: neo4j)
  - `NEO4J_PASSWORD` (default: demodemo)

## Troubleshooting

### Graphiti takes too long to start
Neo4j + Graphiti need ~30-60 seconds to be healthy. Wait for healthchecks to pass.

### Memory tests fail
Check that OPENAI_API_KEY is set in root `.env` file.

### Alpine CLI fails
Known issue with chalk ESM compatibility. Installation works, CLI doesn't.

### Package not found
Ensure you've run `npm run package` before running tests. The package should be in `releases/`.

## Manual Testing

```bash
# Navigate to test directory
cd tests/e2e/installation/docker

# Quick mode - single distro
docker compose up --build ubuntu

# Quick mode - specific CLI
CLI_MODE=claude-only docker compose up --build

# Full mode - with MCP
docker compose --env-file ../../../../.env -f docker-compose.test.yml up --build

# Clean up
docker compose down -v
docker compose -f docker-compose.test.yml down -v
```
