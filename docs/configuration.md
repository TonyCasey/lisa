# Configuration

Lisa can be configured through environment variables, configuration files, and a preference store.

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_MODE` | `local` | Storage backend: `local` (Graphiti MCP), `neo4j` (direct), `zep-cloud` |
| `GRAPHITI_ENDPOINT` | `http://localhost:8010/mcp/` | MCP server endpoint (local mode) |
| `MCP_ENDPOINT` | - | Alternative to `GRAPHITI_ENDPOINT` |
| `LOG_LEVEL` | `error` | Logging level: `debug`, `info`, `warn`, `error`, `silent` |
| `LOG_CONSOLE` | `false` | Write logs to stderr/console |
| `LOG_DIR` | - | Directory for log files (optional) |

### Neo4j Settings (for direct queries)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `demodemo` | Neo4j password |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |

### Zep Cloud Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEP_API_KEY` | - | Your Zep Cloud API key |
| `ZEP_BASE_URL` | `https://api.getzep.com/api/v2` | Zep Cloud API base URL |

### Lisa LLM Settings

Lisa has its own LLM integration for memory curation, conflict detection, consolidation, and transcript enrichment. These are separate from the Graphiti/OpenAI embeddings.

| Variable | Default | Description |
|----------|---------|-------------|
| `LISA_LLM_PROVIDER` | `anthropic` | LLM provider: `anthropic`, `openai`, `ollama` |
| `LISA_LLM_MODEL` | Provider-dependent | Model name (e.g., `claude-sonnet-4-20250514`) |
| `LISA_LLM_API_KEY` | - | API key for the LLM provider |
| `LISA_LLM_ENDPOINT` | Provider-dependent | Custom LLM endpoint URL |
| `LISA_LLM_ENABLED` | `true` | Enable/disable LLM-powered features |

**API key fallback chain:** If `LISA_LLM_API_KEY` is not set, Lisa checks `ANTHROPIC_API_KEY` (for anthropic provider) or `OPENAI_API_KEY` (for openai provider).

### Graphiti MCP Provider Settings

These are used by the Graphiti MCP server (set in project root `.env`):

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (required for embeddings) |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional) |
| `GOOGLE_API_KEY` | Google AI (Gemini) API key (optional) |

## Configuration Files

### .lisa/.env

Main configuration file created by `lisa init`:

```env
# Lisa Configuration
# Storage mode: local (MCP), neo4j (direct queries), zep-cloud
STORAGE_MODE=local

# Logging: debug, info, warn, error, silent
LOG_LEVEL=debug

# Graphiti MCP endpoint (for local mode)
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/

# Neo4j connection (for neo4j mode)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=demodemo
NEO4J_DATABASE=neo4j

# Lisa LLM (for curation, conflict detection, enrichment)
# LISA_LLM_PROVIDER=anthropic
# LISA_LLM_MODEL=claude-sonnet-4-20250514
# LISA_LLM_API_KEY=sk-...

# Zep Cloud (if using)
# ZEP_API_KEY=your-api-key
```

**Load order:** `process.env` > `.lisa/.env` file > hardcoded defaults

### .lisa/preferences.json

File-based key-value store for user preferences. Managed via the `lisa pref` CLI:

```bash
# View all preferences
lisa pref list

# Get a specific preference
lisa pref get llm:provider

# Set a preference
lisa pref set llm:provider anthropic

# Delete a preference
lisa pref delete llm:temperature
```

**LLM preferences:**

| Key | Type | Description |
|-----|------|-------------|
| `llm:provider` | string | LLM provider name |
| `llm:model` | string | Model name |
| `llm:apiKey` | string | API key |
| `llm:endpoint` | string | Custom endpoint URL |
| `llm:enabled` | boolean | Enable/disable LLM features |
| `llm:maxTokens` | number | Max tokens for LLM responses |
| `llm:temperature` | number | Sampling temperature (0-2) |

**Precedence for LLM config:** Defaults < Preferences (`.lisa/preferences.json`) < Environment variables (highest priority)

### .claude/settings.json

Claude Code hook configuration (auto-generated). Lisa registers its hooks here:

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

Hook commands read configuration from environment variables (set via `.lisa/.env`), not from a separate config file.

## LLM Configuration

### Testing LLM Settings

```bash
# Check current LLM config
lisa llm config

# Test LLM connectivity
lisa llm test

# View usage stats
lisa llm usage

# List available features
lisa llm features
```

### LLM-Powered Features

When enabled, Lisa uses its LLM for:

| Feature | Command | Description |
|---------|---------|-------------|
| Memory curation | `lisa memory curate` | Assess fact quality, mark stale/low-value |
| Conflict detection | `lisa memory conflicts` | Find contradictory facts |
| Consolidation | `lisa memory consolidate` | Merge related facts |
| Deduplication | `lisa memory dedupe` | Find and remove duplicates |
| Summarization | `lisa memory summarize` | Generate period summaries |
| Transcript enrichment | (automatic on session stop) | Extract structured facts |

## Storage Management

### Checking Storage Status

```bash
lisa storage status
```

Shows current storage mode, endpoint, and connectivity status.

### Switching Storage Mode

```bash
lisa storage switch
```

Updates `.lisa/.env` with the new storage mode and verifies connectivity.

## Docker Configuration

### docker-compose.graphiti.yml

The Docker Compose file defines services for local mode:

1. **neo4j** - Graph database for storing memories
2. **graphiti-mcp** - MCP server for memory operations

Key environment variables in the compose file:

```yaml
services:
  graphiti-mcp:
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=demodemo
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

### Project Root .env

For Docker, create a `.env` file in your project root with your API keys:

```env
# LLM Provider (required for Graphiti embeddings)
OPENAI_API_KEY=your-openai-key

# Optional: Lisa's own LLM (for curation features)
# ANTHROPIC_API_KEY=your-anthropic-key
```

## Group IDs

Lisa automatically derives the group ID from your project's folder path and normalizes it. This ensures:

- **Per-project isolation**: Each project has its own memory namespace based on the folder path
- **Hierarchical context**: Lisa automatically queries parent folders for inherited context
- **Consistent organization**: Memories are organized by project location, not manual configuration

The group ID is the **normalized** folder path (e.g., `/home/user/projects/my-app` -> `home-user-projects-my-app`, `C:\Users\user\projects\my-app` -> `c-users-user-projects-my-app`). This provides natural project isolation while allowing hierarchical memory inheritance from parent directories.

## Deployment Modes

### Local Mode

- Runs Neo4j and Graphiti via Docker
- Data stored locally in Docker volumes
- Full control over infrastructure
- Requires Docker Desktop or Docker Engine

### Zep Cloud Mode

- Uses Zep's managed service
- No Docker required
- Automatic scaling and backups
- Requires Zep account and API key

### Skip Mode

- Scaffolds project structure
- No storage configured
- Configure manually later via `.lisa/.env`
