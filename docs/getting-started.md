# Getting Started with Lisa

Lisa gives your AI coding assistants persistent memory. Once installed, Claude Code, OpenCode, and other AI assistants automatically remember your project context, decisions, and coding patterns across sessions.

## Prerequisites

- **Node.js** 18+
- **Docker** (optional, for self-hosted Graphiti)
- A project directory where you want memory enabled

## Quick Start

### Option 1: Self-Hosted with Docker (Recommended)

This runs Neo4j and Graphiti locally via Docker.

```bash
# Install Lisa globally
npm install -g @tonycasey/lisa

# Change directory to your project
cd your-project

# IMPORTANT: Lisa's Storage requires an OpenAI API key.
# Create a .env file in your project root with:
#   OPENAI_API_KEY=sk-proj-...
# Or export it in your terminal:
#   export OPENAI_API_KEY=sk-proj-...

# Initialize and start Docker containers
lisa init
lisa up
```

Wait for Docker containers to start (~30 seconds), then start coding with your AI assistant.

### Option 2: Zep Cloud (Managed)

No Docker required - uses [Zep's](https://www.getzep.com/) hosted service.

```bash
npm install -g @tonycasey/lisa
cd your-project
lisa init --mode zep-cloud
```

You'll be prompted for your Zep API key and project ID.

### Option 3: Configure Later

Scaffold the project structure now, configure storage later.

```bash
npm install -g @tonycasey/lisa
cd your-project
lisa init --mode skip
```

## CLI Support Options

Lisa supports multiple AI coding assistants. During `lisa init`, you can choose which to support:

```bash
# Support both Claude Code and OpenCode (default)
lisa init

# Claude Code only
lisa init --claude-only

# OpenCode only
lisa init --opencode-only
```

## Verify Installation

```bash
lisa doctor
```

You should see green checkmarks for:
- Docker (if using local mode)
- Docker Compose
- Compose file found
- MCP reachable

## What Gets Created

After running `lisa init`:

```
your-project/
├── .lisa/
│   ├── skills/           # Memory and task skills
│   ├── rules/            # Coding standards
│   ├── .env              # Configuration (LOG_LEVEL, endpoints, etc.)
│   └── lisa.config.json  # CLI preferences
│
├── .claude/              # (if Claude Code selected)
│   ├── hooks/            # Session lifecycle hooks
│   ├── config.js         # Hook configuration
│   ├── skills -> ../.lisa/skills
│   └── rules -> ../.lisa/rules
│
├── .opencode/            # (if OpenCode selected)
│   ├── plugin/
│   │   └── lisa.js       # OpenCode plugin
│   └── skills -> ../.lisa/skills
│
└── docker-compose.graphiti.yml  # (if using Docker)
```

## Next Steps

- [Commands Reference](./commands.md) - Full CLI documentation
- [Configuration](./configuration.md) - Environment variables and settings
- [Using Skills](./skills.md) - How memory and tasks work
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
