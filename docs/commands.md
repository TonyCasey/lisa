# CLI Commands Reference

## lisa init

Initialize a project with Lisa memory support.

```bash
lisa init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | MCP endpoint (default: `http://localhost:8010/mcp/`) |
| `-g, --group <id>` | Group ID for memories (default: project folder name) |
| `-f, --force` | Overwrite existing files (except `.lisa/.env`) |
| `-m, --mode <mode>` | Deployment mode: `local`, `zep-cloud`, or `skip` |
| `--zep-api-key <key>` | Zep API key (for zep-cloud mode) |
| `--zep-project-id <id>` | Zep project ID (for zep-cloud mode) |
| `-y, --yes` | Skip interactive prompts, use defaults |
| `--claude-only` | Only set up Claude Code support |
| `--opencode-only` | Only set up OpenCode support |
| `--isolated` | Install to `.claude/lib` for non-npm projects |

### Examples

```bash
# Interactive setup (both CLIs)
lisa init

# Non-interactive with defaults
lisa init -y

# Claude Code only
lisa init --claude-only

# OpenCode only
lisa init --opencode-only

# Zep Cloud mode
lisa init --mode zep-cloud --zep-api-key YOUR_KEY --zep-project-id YOUR_PROJECT

# Custom group ID
lisa init -g my-custom-group

# For Python/Go projects (keeps root clean)
lisa init --isolated
```

### What It Creates

- `.lisa/` - Skills, rules, and configuration
- `.lisa/.env` - Environment configuration (created on first init only)
- `.claude/` - Claude Code configuration (if selected)
  - `settings.json` - Hook commands registered here
  - `skills/lisa/` - Symlink to `.lisa/skills`
  - `rules/lisa/` - Symlink to `.lisa/rules`
- `.opencode/` - OpenCode plugin (if selected)
  - `plugin/lisa.js` - Bundled plugin
  - `skills/` - Individual skill symlinks
- `docker-compose.graphiti.yml` - Docker stack (if local mode)

**Note:** Lisa uses subdirectory symlinks to preserve any existing user files in `.claude/` or `.opencode/`.

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

### Example Output (Local Mode)

```
Mode: local
Group: my-project

Docker OK: Docker version 24.0.7
Docker Compose OK: Docker Compose version v2.23.0
Compose file found: docker-compose.graphiti.yml
MCP reachable at http://localhost:8010/mcp/
```

### Example Output (Zep Cloud)

```
Mode: zep-cloud
Group: my-project

Zep Cloud mode - no local Docker required

Zep MCP reachable at https://api.getzep.com/mcp/
```

---

## lisa sync

Sync copied directories when symlinks couldn't be created.

On some systems (e.g., Windows without developer mode), Lisa falls back to copying directories instead of creating symlinks. This command syncs those copies with the source.

```bash
lisa sync [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Project directory (default: current directory) |

### Example

```bash
lisa sync
```

This reads `.lisa/.copy-fallbacks.json` and updates any copied directories from their source.

---

## lisa version

Show Lisa version.

```bash
lisa --version
lisa -V
```

---

## lisa hook

Hook commands invoked by Claude Code during session lifecycle events. These are registered in `.claude/settings.json` and called automatically.

```bash
lisa hook <event>
```

### Subcommands

| Command | Description |
|---------|-------------|
| `lisa hook session-start` | Load memory context at session start |
| `lisa hook session-stop` | Capture work when session stops |
| `lisa hook user-prompt-submit` | Process user prompts |

### How Hooks Work

Hooks are registered in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "lisa hook session-start" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "lisa hook session-stop" }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "lisa hook user-prompt-submit" }]
    }]
  }
}
```

Claude Code invokes these commands at the appropriate lifecycle events. The hooks:
- Read JSON from stdin (event context)
- Output JSON to stdout (context for Claude)
- Write status messages to stderr (visible to user)

### Manual Testing

```bash
# Test session-start hook
echo '{"source":"startup"}' | lisa hook session-start

# Test with resume trigger
echo '{"source":"resume"}' | lisa hook session-start

# Test session-stop hook
echo '{"session_id":"test"}' | lisa hook session-stop
```

---

## lisa help

Show help for any command.

```bash
lisa --help
lisa init --help
lisa doctor --help
```
