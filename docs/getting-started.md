# Getting Started with Lisa

Lisa gives your AI coding assistants persistent memory. Once installed, Claude Code (and other AI assistants) automatically remember your project context, decisions, and coding patterns across sessions.

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

# In your project
cd your-project
lisa init
lisa up
```

Wait for Docker containers to start (~30 seconds), then start coding with Claude Code.

### Option 2: [Zep's](https://www.getzep.com/) Cloud (Managed)

No Docker required - uses [Zep's](https://www.getzep.com/) hosted service.

```bash
npm install -g @tonycasey/lisa
cd your-project
lisa setup --mode zep-cloud
```

You'll be prompted for your [Zep's](https://www.getzep.com/) API key and project ID.

### Option 3: Configure Later

Scaffold the project structure now, configure storage later.

```bash
npm install -g @tonycasey/lisa
cd your-project
lisa setup --mode skip
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

After running `lisa init` or `lisa setup`:

```
your-project/
├── .agents/
│   ├── skills/           # Memory and task skills
│   ├── rules/            # Coding standards
│   └── .env              # Configuration
│
├── .claude/
│   ├── hooks/            # Session hooks
│   ├── settings.json     # Claude Code settings
│   └── config.js         # Configuration
│
└── docker-compose.graphiti.yml  # (if using Docker)
```




## Next Steps

- [Commands Reference](./commands.md) - Full CLI documentation
- [Configuration](./configuration.md) - Environment variables and settings
- [Using Skills](./skills.md) - How memory and tasks work
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
