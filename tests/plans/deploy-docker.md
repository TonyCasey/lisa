# Deployment Test Plan - Docker (Multi-OS)

## Overview

Test the lisa package installation across different operating systems using Docker containers. This ensures cross-platform compatibility before publishing.

**Supported Docker Testing:**
- Ubuntu (22.04, 24.04)
- Debian (bookworm)
- Alpine Linux
- Amazon Linux 2023
- Fedora

**Not Supported in Docker (requires alternative):**
- macOS (Apple licensing prevents Docker containers - use VM or real hardware)
- Windows (use native testing per `deploy-test-plan-windows.md`)

---

## Prerequisites

1. Docker Desktop installed and running
2. Built package (.tgz) from the lisa project
3. Docker Compose (optional, for parallel testing)

---

## Step 1: Build & Pack (Host Machine)

From the lisa project root:

```bash
# Windows
cd C:/dev/lisa
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages
# Creates: dist/packages/tonycasey-lisa-x.x.xx.tgz

# Linux/macOS
cd ~/dev/lisa
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages
```

---

## Step 2: Docker Test Environments

### Directory Structure

```
tests/
├── plans/deploy-docker.md          # This file
├── docker/
│   ├── Dockerfile.ubuntu           # Ubuntu 22.04 test image
│   ├── Dockerfile.debian           # Debian bookworm test image
│   ├── Dockerfile.alpine           # Alpine Linux test image
│   ├── Dockerfile.amazonlinux      # Amazon Linux 2023 test image
│   ├── Dockerfile.fedora           # Fedora test image
│   ├── docker-compose.yml          # Run all tests in parallel
│   ├── scripts/
│   │   ├── run-tests.sh            # Main test runner script
│   │   ├── setup-project.sh        # Create sample projects
│   │   └── verify-installation.sh  # Verification checklist
│   └── projects/                   # Sample projects (mounted)
│       ├── typescript/
│       ├── python/
│       ├── javascript/
│       └── go/
```

---

## Step 3: Dockerfiles

### Dockerfile.ubuntu

```dockerfile
FROM ubuntu:22.04

# Install Node.js 20.x
RUN apt-get update && apt-get install -y curl git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

# Install Docker CLI (for Docker-in-Docker or host socket mount)
RUN apt-get install -y docker.io || true

# Create test user (non-root)
RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

# Copy package
COPY --chown=testuser:testuser dist/packages/tonycasey-lisa-*.tgz /home/testuser/

# Create test projects
RUN mkdir -p projects/typescript projects/python projects/javascript projects/go

CMD ["/bin/bash"]
```

### Dockerfile.debian

```dockerfile
FROM debian:bookworm

RUN apt-get update && apt-get install -y curl git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser dist/packages/tonycasey-lisa-*.tgz /home/testuser/
RUN mkdir -p projects/typescript projects/python projects/javascript projects/go

CMD ["/bin/bash"]
```

### Dockerfile.alpine

```dockerfile
FROM alpine:3.19

RUN apk add --no-cache nodejs npm git bash docker-cli

RUN adduser -D -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser dist/packages/tonycasey-lisa-*.tgz /home/testuser/
RUN mkdir -p projects/typescript projects/python projects/javascript projects/go

CMD ["/bin/bash"]
```

### Dockerfile.amazonlinux

```dockerfile
FROM amazonlinux:2023

RUN dnf install -y nodejs20 npm git docker \
    && dnf clean all

RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser dist/packages/tonycasey-lisa-*.tgz /home/testuser/
RUN mkdir -p projects/typescript projects/python projects/javascript projects/go

CMD ["/bin/bash"]
```

### Dockerfile.fedora

```dockerfile
FROM fedora:40

RUN dnf install -y nodejs npm git docker \
    && dnf clean all

RUN useradd -m -s /bin/bash testuser
USER testuser
WORKDIR /home/testuser

COPY --chown=testuser:testuser dist/packages/tonycasey-lisa-*.tgz /home/testuser/
RUN mkdir -p projects/typescript projects/python projects/javascript projects/go

CMD ["/bin/bash"]
```

---

## Step 4: Test Scripts

### run-tests.sh

```bash
#!/bin/bash
set -e

OS_NAME=${1:-"unknown"}
PACKAGE_PATH=${2:-"/home/testuser/tonycasey-lisa-*.tgz"}

echo "=========================================="
echo "Testing lisa package on: $OS_NAME"
echo "=========================================="

# Test each project type
for PROJECT in typescript python javascript go; do
    echo ""
    echo "--- Testing $PROJECT project ---"

    cd ~/projects/$PROJECT

    # Initialize if needed
    if [ ! -f package.json ]; then
        npm init -y
    fi

    # Install lisa package
    echo "Installing lisa package..."
    npm install $PACKAGE_PATH

    # Run verification
    source ~/scripts/verify-installation.sh

    echo "--- $PROJECT: PASSED ---"
done

echo ""
echo "=========================================="
echo "All tests PASSED on $OS_NAME"
echo "=========================================="
```

### verify-installation.sh

```bash
#!/bin/bash
# Verification Checklist - mirrors Windows test plan

PASS=0
FAIL=0

check() {
    local name="$1"
    local command="$2"

    echo -n "  Checking: $name... "
    if eval "$command" > /dev/null 2>&1; then
        echo "PASS"
        ((PASS++))
    else
        echo "FAIL"
        ((FAIL++))
    fi
}

echo "Running verification checklist..."

# 1. CLI accessible
check "lisa CLI accessible" "npx lisa --help"

# 2. .agents/ folder created with skills
check ".agents/ folder exists" "[ -d .agents ]"
check ".agents/skills/ exists" "[ -d .agents/skills ]"

# 3. .claude/ folder created with hooks
check ".claude/ folder exists" "[ -d .claude ]"
check ".claude/hooks/ exists" "[ -d .claude/hooks ]"

# 4. Skills files present
check "memory skill exists" "[ -f .agents/skills/memory/SKILL.md ]"
check "tasks skill exists" "[ -f .agents/skills/tasks/SKILL.md ]"
check "lisa skill exists" "[ -f .agents/skills/lisa/SKILL.md ]"

# 5. Hooks files present
check "session-start hook exists" "[ -f .claude/hooks/session-start.js ] || [ -f .claude/hooks/session-start.cjs ]"
check "user-prompt-submit hook exists" "[ -f .claude/hooks/user-prompt-submit.js ] || [ -f .claude/hooks/user-prompt-submit.cjs ]"

# 6. Port checking (basic test)
check "Port utility exists" "[ -f .agents/skills/memory/scripts/memory.js ] || [ -f .agents/skills/memory/scripts/memory.cjs ]"

# Summary
echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
```

### setup-project.sh

```bash
#!/bin/bash
# Create sample boilerplate projects

# TypeScript project
mkdir -p ~/projects/typescript
cd ~/projects/typescript
cat > package.json << 'EOF'
{
  "name": "test-typescript",
  "version": "1.0.0",
  "description": "TypeScript test project for lisa",
  "scripts": {
    "build": "tsc",
    "test": "echo 'test'"
  }
}
EOF

# Python project
mkdir -p ~/projects/python
cd ~/projects/python
cat > package.json << 'EOF'
{
  "name": "test-python",
  "version": "1.0.0",
  "description": "Python test project for lisa"
}
EOF

# JavaScript project
mkdir -p ~/projects/javascript
cd ~/projects/javascript
cat > package.json << 'EOF'
{
  "name": "test-javascript",
  "version": "1.0.0",
  "description": "JavaScript test project for lisa"
}
EOF

# Go project
mkdir -p ~/projects/go
cd ~/projects/go
cat > package.json << 'EOF'
{
  "name": "test-go",
  "version": "1.0.0",
  "description": "Go test project for lisa"
}
EOF

echo "Sample projects created."
```

---

## Step 5: Docker Compose (Parallel Testing)

### docker-compose.yml

```yaml
version: '3.8'

services:
  ubuntu:
    build:
      context: .
      dockerfile: Dockerfile.ubuntu
    container_name: lisa-test-ubuntu
    volumes:
      - ./test-scripts:/home/testuser/test-scripts:ro
      - /var/run/docker.sock:/var/run/docker.sock  # Optional: Docker-in-Docker
    command: bash -c "/home/testuser/scripts/run-tests.sh ubuntu"

  debian:
    build:
      context: .
      dockerfile: Dockerfile.debian
    container_name: lisa-test-debian
    volumes:
      - ./test-scripts:/home/testuser/test-scripts:ro
    command: bash -c "/home/testuser/scripts/run-tests.sh debian"

  alpine:
    build:
      context: .
      dockerfile: Dockerfile.alpine
    container_name: lisa-test-alpine
    volumes:
      - ./test-scripts:/home/testuser/test-scripts:ro
    command: bash -c "/home/testuser/scripts/run-tests.sh alpine"

  amazonlinux:
    build:
      context: .
      dockerfile: Dockerfile.amazonlinux
    container_name: lisa-test-amazonlinux
    volumes:
      - ./test-scripts:/home/testuser/test-scripts:ro
    command: bash -c "/home/testuser/scripts/run-tests.sh amazonlinux"

  fedora:
    build:
      context: .
      dockerfile: Dockerfile.fedora
    container_name: lisa-test-fedora
    volumes:
      - ./test-scripts:/home/testuser/test-scripts:ro
    command: bash -c "/home/testuser/scripts/run-tests.sh fedora"
```

---

## Step 6: Running the Tests

### Option A: Run All Tests in Parallel

```bash
# From tests/e2e/deploy/docker/ directory
cd tests/docker

# Copy the built package
cp ../../tonycasey-lisa-*.tgz .

# Build and run all containers
docker-compose up --build

# View results
docker-compose logs
```

### Option B: Run Individual OS Tests

```bash
# Ubuntu
docker build -f Dockerfile.ubuntu -t lisa-test-ubuntu .
docker run -it --rm \
    -v $(pwd)/test-scripts:/home/testuser/test-scripts:ro \
    lisa-test-ubuntu \
    bash -c "/home/testuser/scripts/run-tests.sh ubuntu"

# Debian
docker build -f Dockerfile.debian -t lisa-test-debian .
docker run -it --rm \
    -v $(pwd)/test-scripts:/home/testuser/test-scripts:ro \
    lisa-test-debian \
    bash -c "/home/testuser/scripts/run-tests.sh debian"

# Alpine
docker build -f Dockerfile.alpine -t lisa-test-alpine .
docker run -it --rm \
    -v $(pwd)/test-scripts:/home/testuser/test-scripts:ro \
    lisa-test-alpine \
    bash -c "/home/testuser/scripts/run-tests.sh alpine"
```

### Option C: Interactive Testing (Debug Mode)

```bash
# Start container interactively
docker run -it --rm \
    -v $(pwd)/test-scripts:/home/testuser/test-scripts:ro \
    lisa-test-ubuntu \
    bash

# Inside container, run tests manually
cd ~/projects/typescript
npm install /home/testuser/tonycasey-lisa-*.tgz
npx lisa --help
ls -la .agents/
ls -la .claude/
```

---

## Step 7: Verification Checklist (Per OS)

For each operating system, verify:

| Check | Command | Expected |
|-------|---------|----------|
| CLI accessible | `npx lisa --help` | Shows help text |
| .agents/ created | `ls -la .agents/` | Folder exists with skills |
| .claude/ created | `ls -la .claude/` | Folder exists with hooks |
| Memory skill | `ls .agents/skills/memory/` | SKILL.md and scripts/ |
| Tasks skill | `ls .agents/skills/tasks/` | SKILL.md and scripts/ |
| Lisa skill | `ls .agents/skills/lisa/` | SKILL.md |
| Session hook | `ls .claude/hooks/` | session-start.js or .cjs |
| Prompt hook | `ls .claude/hooks/` | user-prompt-submit.js or .cjs |

---

## Step 8: Memory Persistence Test

Test that memory works correctly in each container:

```bash
# Add a test memory
node .agents/skills/memory/scripts/memory.js add "Docker test memory for $(hostname)" --cache

# In a new shell (or new container run), load memories
node .agents/skills/memory/scripts/memory.js load --cache

# Verify the test memory exists in output
```

---

## Step 9: macOS Testing (Alternative Approach)

Since macOS cannot run in Docker, use one of these alternatives:

### Option A: GitHub Actions with macOS Runner

```yaml
# .github/workflows/test-macos.yml
name: Test on macOS
on: [push, pull_request]

jobs:
  test-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm run build
      - run: npm pack
      - run: |
          mkdir -p ~/test-project
          cd ~/test-project
          npm init -y
          npm install ${{ github.workspace }}/tonycasey-lisa-*.tgz
          npx lisa --help
          ls -la .agents/
          ls -la .claude/
```

### Option B: Manual Testing on macOS Hardware

Follow the Windows test plan (`deploy-test-plan-windows.md`) but with macOS paths:

```bash
# Build & Pack
cd ~/dev/lisa
npm run build
npm pack

# Test folder
mkdir -p ~/dev/lisa-tests/{typescript,python,javascript,go}

# Install and verify
cd ~/dev/lisa-tests/typescript
npm init -y
npm install ~/dev/lisa/tonycasey-lisa-*.tgz
npx lisa --help
```

---

## Summary: Test Matrix

| OS | Method | Status | Notes |
|----|--------|--------|-------|
| Windows | Native (deploy-test-plan-windows.md) | Manual | - |
| Ubuntu 22.04 | Docker | **PASSED** (11/11) | Full compatibility |
| Debian Bookworm | Docker | **PASSED** (11/11) | Full compatibility |
| Alpine 3.20 | Docker | **PARTIAL** (10/11) | CLI fails due to chalk ESM issue |
| Fedora 40 | Docker | **PASSED** (11/11) | Full compatibility |
| macOS | GitHub Actions or Manual | Pending | Apple licensing prevents Docker |

### Known Issues

**Alpine Linux**: The lisa CLI fails to run due to an ESM/CommonJS compatibility issue with the `chalk` package. Package installation and file deployment works correctly (10/11 checks pass). Only the CLI execution fails. This is a chalk library issue with Alpine's Node.js build.

**Workaround for Alpine**: Use Debian or Ubuntu-based containers instead for production deployments.

---

## Quick Start

```bash
# 1. Build the package
cd /path/to/lisa
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages

# 2. Run all Docker tests
cd tests/e2e/deploy/docker
docker-compose up --build

# 3. Check results
docker-compose logs | grep -E "(PASSED|FAILED)"
```

---

## Full Integration Testing (with Memory Persistence)

For complete end-to-end testing including Neo4j + Graphiti memory persistence:

### Prerequisites

Ensure root `.env` file has:
- `OPENAI_API_KEY` (required for entity extraction)
- `NEO4J_USER` (default: neo4j)
- `NEO4J_PASSWORD` (default: demodemo)

### Run Full Tests

```bash
# 1. Build the package
npm run build
mkdir -p dist/packages && npm pack --pack-destination dist/packages

# 2. Run full integration tests (includes Neo4j + Graphiti)
cd tests/e2e/deploy/docker
docker compose --env-file ../../../../.env -f docker-compose.test.yml up --build

# 3. Check results
docker compose --env-file ../../../../.env -f docker-compose.test.yml logs test-ubuntu | grep -E "(PASS|FAIL)"
```

### Full Test Checks

The full integration tests include:

**Phase 1: Installation (11 checks)**
- CLI accessible
- .agents/ folder created
- .claude/ folder created
- All skills present (memory, tasks, lisa)
- All hooks present (session-start, user-prompt-submit)
- Memory script exists

**Phase 2: Memory Persistence (4 checks)**
- Memory add succeeds
- Memory load succeeds
- Memory retrieval finds added memory
- Group isolation (different projects = different memories)

### Test All OS Distributions

```bash
# Run tests on all OS distributions
docker compose --env-file ../../../../.env -f docker-compose.test.yml --profile all up --build
```

---

## Troubleshooting

### Docker Build Fails
- Ensure Docker Desktop is running
- Check network connectivity for package downloads
- Try `docker system prune` to clear cache

### Permission Errors
- The Dockerfiles create a non-root user `testuser`
- Ensure files are copied with correct ownership

### Node.js Version Issues
- All Dockerfiles target Node.js 20.x
- Verify with `node --version` inside container

### Graphiti Index Initialization Error
If you see `EquivalentSchemaRuleAlreadyExists` errors, this is a race condition in Graphiti's parallel index creation. Solutions:
- Clean volumes: `docker compose --env-file ../../../../.env -f docker-compose.test.yml down -v`
- Restart the test: `docker compose --env-file ../../../../.env -f docker-compose.test.yml up --build`
- If persistent, the main `lisa` docker-compose may need to be stopped first

### Docker-in-Docker Issues
- Memory/Docker features requiring containers won't work without socket mounting
- Mount `/var/run/docker.sock` for full Docker support inside containers

