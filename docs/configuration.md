# Configuration

Lisa can be configured through environment variables and configuration files.

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPHITI_ENDPOINT` | `http://localhost:8010/mcp/` | MCP server endpoint |
| `GRAPHITI_GROUP_ID` | Project name | Group ID for organizing memories |
| `CODING_USER_NAME` | `$USER` | User name for tagging memories |

### Zep Cloud Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEP_API_KEY` | - | Your Zep Cloud API key |
| `ZEP_PROJECT_ID` | - | Your Zep Cloud project ID |

### LLM Provider Settings

These are used by the Graphiti MCP server:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google AI (Gemini) API key |

## Configuration Files

### .agents/.env

Main configuration file created by `lisa init` or `lisa setup`:

```env
# Graphiti MCP Configuration
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project

# Storage mode: local, zep-cloud
STORAGE_MODE=local

# Zep Cloud (if using)
# ZEP_API_KEY=your-api-key
# ZEP_PROJECT_ID=your-project-id
```

### .claude/settings.json

Claude Code settings:

```json
{
  "permissions": {
    "allow": ["Bash(npm:*)", "Bash(node:*)"],
    "deny": []
  }
}
```

### .claude/config.js

Hook configuration:

```javascript
module.exports = {
  hooks: {
    sessionStart: './hooks/session-start.js',
    sessionStop: './hooks/session-stop.js',
    userPromptSubmit: './hooks/user-prompt-submit.js'
  }
};
```

## Docker Configuration

### docker-compose.graphiti.yml

The Docker Compose file defines three services:

1. **neo4j** - Graph database for storing memories
2. **graphiti-mcp** - MCP server for memory operations
3. **redis** (optional) - Caching layer

Key environment variables in the compose file:

```yaml
services:
  graphiti-mcp:
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=password
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

### .env.lisa.example

Template for Docker environment:

```env
# LLM Provider (choose one)
OPENAI_API_KEY=your-openai-key
# ANTHROPIC_API_KEY=your-anthropic-key
# GOOGLE_API_KEY=your-google-key

# Neo4j (usually leave defaults)
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
```

Copy to `.env` and fill in your API keys:

```bash
cp .env.lisa.example .env
```

## Group IDs

The `GRAPHITI_GROUP_ID` determines how memories are organized:

- **Per-project** (default): Each project has its own memory namespace
- **Shared**: Use the same group ID across projects to share memories
- **Per-user**: Include username in group ID for personal memories

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
- Configure manually later via `.agents/.env`
