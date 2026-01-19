# Configuration

Lisa can be configured through environment variables and configuration files.

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHITI_ENDPOINT` | `http://localhost:8010/mcp/` | MCP server endpoint |
| `GRAPHITI_GROUP_ID` | Project folder name | Group ID for organizing memories |
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

# Group ID (optional - defaults to folder name)
# GRAPHITI_GROUP_ID=my-project

# Zep Cloud (if using)
# ZEP_API_KEY=your-api-key
```

### .lisa/lisa.config.json

Stores CLI preferences and configuration:

```json
{
  "graphiti": {
    "mode": "local",
    "endpoint": "http://localhost:8010/mcp/",
    "groupId": "my-project"
  },
  "cliSupport": ["claude-code", "opencode"]
}
```

### .claude/config.js

Claude Code hook configuration (auto-generated):

```javascript
module.exports = {
  PROJECT_ROOT: process.cwd(),
  DEV_DIR: '.dev',
  MCP_ENDPOINT: process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/',
  // ... other settings
};
```

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

The `GRAPHITI_GROUP_ID` determines how memories are organized:

- **Per-project** (default): Each project has its own memory namespace
- **Shared**: Use the same group ID across projects to share memories
- **Hierarchical**: Lisa automatically queries parent folders for inherited context

### Examples

```bash
# Project-specific (default)
lisa init -g my-project

# Shared across projects
lisa init -g company-standards

# Per-user
lisa init -g ${USER}-personal
```

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
