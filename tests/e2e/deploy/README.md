# Deployment Integration Tests

Tests for verifying lisa package installation and functionality across different environments.

## Test Methods

### Docker (Linux Distributions)

Located in `docker/` - tests package installation across:
- Ubuntu 22.04
- Debian Bookworm
- Alpine Linux
- Fedora 40

**Two modes:**
- Quick Mode: Installation verification only (11 checks)
- Full Mode: Installation + Memory persistence with Neo4j + Graphiti

See `docker/README.md` for usage.

### Windows

Native testing on Windows. See `../../plans/deploy-windows.md`.

### macOS

Not supported via Docker (Apple licensing). Use VM or real hardware.
