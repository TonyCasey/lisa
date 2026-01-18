# CLI Commands Reference

## lisa init

Scaffold project with Docker assets for self-hosted Graphiti.

```bash
lisa init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | MCP endpoint (default: `http://localhost:8010/mcp/`) |
| `-g, --group <id>` | Group ID for memories (default: project name) |
| `-f, --force` | Overwrite existing files |
| `-m, --mode <mode>` | Deployment mode: `local`, `zep-cloud`, or `skip` |
| `--zep-api-key <key>` | Zep API key (for zep-cloud mode) |
| `--zep-project-id <id>` | Zep project ID (for zep-cloud mode) |
| `-y, --yes` | Skip interactive prompts, use defaults |
| `--isolated` | Install to `.claude/lib` for non-npm projects |

### Examples

```bash
# Interactive setup
lisa init

# Non-interactive with defaults
lisa init -y

# Zep Cloud mode
lisa init --mode zep-cloud --zep-api-key YOUR_KEY --zep-project-id YOUR_PROJECT

# Custom group ID
lisa init -g my-custom-group

# For Python/Go projects (keeps root clean)
lisa init --isolated
```

### What It Creates

- `.lisa/` - Skills and rules
- `.claude/` - Hooks and settings
- `.codex/` - Codex integration (in progress)
- `docker-compose.graphiti.yml` - Docker stack
- `.env.lisa.example` - Environment template

---

## lisa setup

Scaffold project without Docker assets. Use when connecting to an existing Graphiti server or Zep Cloud.

```bash
lisa setup [options]
```

### Options

Same as `lisa init`, but does not create Docker compose file.

### Examples

```bash
# Connect to existing Graphiti server
lisa setup -e http://my-server:8010/mcp/

# Zep Cloud
lisa setup --mode zep-cloud

# Configure later
lisa setup --mode skip
```

---

## lisa up

Start the Docker stack (Neo4j + Graphiti MCP server).

```bash
lisa up [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |

### Example

```bash
lisa up
lisa up -c custom-compose.yml
```

---

## lisa down

Stop the Docker stack.

```bash
lisa down [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |

### Example

```bash
lisa down
```

---

## lisa doctor

Validate Docker and MCP connectivity.

```bash
lisa doctor [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |
| `-e, --endpoint <url>` | Override MCP endpoint for testing |

### Example Output

```
Mode: local
Group: my-project

Docker OK: Docker version 24.0.7
Docker Compose OK: Docker Compose version v2.23.0
Compose file found: docker-compose.graphiti.yml
MCP reachable at http://localhost:8010/mcp/
```

### Zep Cloud Output

```
Mode: zep-cloud
Group: my-project

Zep Cloud mode - no local Docker required

Zep MCP reachable at https://api.getzep.com/mcp/
```
