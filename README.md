# Lisa – Long Term Memory for AI Coding Assistants

![Lisa for Claude](assets/claude-i-remember.png)


> *Lisa, never forgets a fact, a detail, or a saxophone lesson.*

---

## Supported CLI Tools

Lisa works with multiple AI coding assistants:

| CLI Tool | Status | Hooks | Skills |
|----------|--------|-------|--------|
| **Claude Code** | Stable | Session hooks, prompt capture | Full support |
| **OpenCode** | Stable | Plugin-based lifecycle events | Full support |

---

## Why Lisa?

Unlike simple vector databases or file-based memory, Lisa uses **[Graphiti](https://github.com/getzep/graphiti)** - a knowledge graph that captures *relationships* between concepts, not just text.

- **Graph-native storage** (Neo4j) - Connections matter as much as content
- **LLM-powered extraction** - Automatically identifies entities and relationships
- **Temporal awareness** - Knows *when* you learned something
- **Semantic retrieval** - Finds relevant context by meaning, not keywords
- **Multi-CLI support** - Works with Claude Code and OpenCode

---

## Installation

### Quick Start

```bash
# Install Lisa
npm install @tonycasey/lisa

# Initialize with interactive prompts
npx lisa init
```

During initialization, you'll be prompted to select:
1. **Storage mode**: Local Docker or Zep Cloud
2. **CLI tools**: Claude Code, OpenCode, or both

### CLI-Specific Installation

```bash
# Claude Code only
npx lisa init --claude-only

# OpenCode only
npx lisa init --opencode-only

# Both (default)
npx lisa init
```

### Non-Interactive Installation

```bash
# Use defaults (both CLIs, local Docker)
npx lisa init -y

# Specify mode
npx lisa init -y --mode local
npx lisa init -y --mode zep-cloud --zep-api-key YOUR_KEY --zep-project-id YOUR_PROJECT
```

---

## Using Lisa

Once installed, Lisa works automatically. Your AI assistant will:

1. **Load context at session start** - Previous memories and project context
2. **Capture important info during coding** - Decisions, patterns, etc.
3. **Remember explicitly when asked** - Say "remember that..." to save important notes

### Explicit Memory Commands

During a coding session:

- "remember that we decided to use Redux for state management"
- "hey lisa, what do you know about the authentication system?"
- "lisa, show me recent memories"
- "lisa, what tasks are we working on?"

### OpenCode Plugin

For OpenCode users, Lisa provides a plugin that:
- Loads memory context on session start
- Captures session work on idle/stop
- Injects context after compaction

The plugin is automatically configured during `lisa init --opencode-only` or when selecting OpenCode during interactive setup.

---

## Configuration

### Directory Structure

After initialization, Lisa creates:

```
your-project/
├── .lisa/                          # Shared resources
│   ├── skills/                       # Memory, tasks, lisa skills
│   ├── rules/                        # Coding standards
│   ├── logs/                         # Log files (auto-rotated daily)
│   ├── .env                          # Storage and logging configuration
│   ├── lisa.config.json              # CLI preferences and storage config
│   └── docker-compose.graphiti.yml   # Local Docker services (if local mode)
├── .claude/                          # Claude Code specific (if selected)
│   ├── hooks/                        # Session lifecycle hooks
│   ├── config.js                     # Hook configuration
│   ├── settings.json                 # Claude Code settings
│   ├── skills -> ../.lisa/skills   # Symlink to shared skills
│   └── rules -> ../.lisa/rules     # Symlink to shared rules
└── .opencode/                        # OpenCode specific (if selected)
    ├── plugin/                       # Lisa plugin (lisa.js)
    └── skill -> ../.lisa/skills    # Symlink to shared skills
```

### Windows Support

On Windows, Lisa uses junctions (similar to symlinks) to share skills and rules between CLI tools. If junctions fail (rare), Lisa falls back to copying directories and tracks them for sync.

```bash
# Re-sync copied directories after Lisa updates
npx lisa sync
```

---

## Commands

| Command | Description |
|---------|-------------|
| `lisa init` | Initialize Lisa with interactive prompts |
| `lisa setup` | Initialize without Docker assets |
| `lisa up` | Start local Docker services |
| `lisa down` | Stop local Docker services |
| `lisa doctor` | Validate configuration and connectivity |
| `lisa sync` | Sync copied directories (Windows fallback) |
| `lisa scan [path]` | Scan directory for project knowledge |

---

## Storage Options

### Local Docker (Recommended for development)

```bash
lisa init --mode local
lisa up  # Start Neo4j + Graphiti MCP
```

### Zep Cloud (Recommended for teams)

```bash
lisa init --mode zep-cloud --zep-api-key KEY --zep-project-id PROJECT
```

---

## Logging

Lisa uses structured logging with automatic file rotation. Configure via `.lisa/.env`:

```bash
LOG_LEVEL=info          # trace, debug, info, warn, error, fatal
LOG_DIR=.lisa/logs    # Log file directory
LOG_CONSOLE=false       # Enable console output (default: false)
LOG_FILE=true           # Enable file output (default: true)
```

Logs are written to `.lisa/logs/` with daily rotation:
- `lisa-YYYY-MM-DD.log` - Main application logs
- `hooks-YYYY-MM-DD.log` - Claude Code hook logs
- `skills-YYYY-MM-DD.log` - Skills script logs

All logging is async and non-blocking.

---

See the [Getting Started Guide](./docs/getting-started.md)

---

[Contributing](./CONTRIBUTING.md) | [Changelog](./CHANGELOG.md)
