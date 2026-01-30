# Configuration

Lisa can be configured through environment variables and configuration files.

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHITI_ENDPOINT` | `http://localhost:8010/mcp/` | MCP server endpoint |
| `LOG_LEVEL` | `debug` | Logging level: `debug`, `info`, `warn`, `error`, `silent` |
| `STORAGE_MODE` | `local` | Storage mode: `local`, `neo4j`, `zep-cloud` |

### Zep Cloud Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEP_API_KEY` | - | Your Zep Cloud API key |
| `ZEP_PROJECT_ID` | - | Your Zep Cloud project ID |

### Neo4j Settings (for direct queries)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `demodemo` | Neo4j password |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |

### LLM Provider Settings

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

# Zep Cloud (if using)
# ZEP_API_KEY=your-api-key
```

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
# LLM Provider (required for embeddings)
OPENAI_API_KEY=your-openai-key

# Optional providers
# ANTHROPIC_API_KEY=your-anthropic-key
# GOOGLE_API_KEY=your-google-key
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
