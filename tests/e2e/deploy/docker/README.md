# Docker Deployment Tests

Test lisa package installation and memory persistence across multiple Linux distributions.

## Two Testing Modes

### Quick Mode (Installation Only)
Tests package installation without memory persistence. No API key required.

```bash
# From project root
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages
npm run e2e:docker:quick
```

### Full Mode (Installation + Memory Persistence)
Tests complete integration with Neo4j + Graphiti. Requires OPENAI_API_KEY in root `.env`.

```bash
# From project root (ensure .env has OPENAI_API_KEY)
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages
npm run e2e:docker:full
```

## Test Results

| OS | Quick Mode | Full Mode |
|----|-----------|-----------|
| Ubuntu 22.04 | 11/11 PASS | Pending |
| Debian Bookworm | 11/11 PASS | Pending |
| Alpine 3.20 | 10/11 (CLI issue) | Pending |
| Fedora 40 | 11/11 PASS | Pending |

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Quick mode - installation tests only |
| `docker-compose.test.yml` | Full mode - includes Neo4j + Graphiti |
| `Dockerfile.*` | OS-specific Docker images |
| `scripts/run-tests.sh` | Quick mode test runner |
| `scripts/run-full-tests.sh` | Full mode test runner |
| `scripts/verify-installation.sh` | Installation checks (11 items) |
| `scripts/test-memory-persistence.sh` | Memory persistence checks |
| `scripts/setup-project.sh` | Create sample projects |

## Environment Requirements

### Quick Mode
- Docker Desktop running
- Built package (.tgz) in `dist/packages/` folder

### Full Mode
- Docker Desktop running
- Built package (.tgz) in `dist/packages/` folder
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

## Full Documentation

See `../../../plans/deploy-docker.md` for complete test plan.
