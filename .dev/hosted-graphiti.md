# Plan: Remote Graphiti Support

## Overview
Add support for remote Graphiti configurations during `lisa init`, giving users three deployment options:
1. **Local Docker** (existing) - Full local stack with Neo4j + Graphiti MCP
2. **Remote Neo4j** (new) - Self-hosted Graphiti MCP connecting to Neo4j Aura
3. **Zep Cloud** (new) - Fully managed Graphiti service

## User Experience

### Interactive Flow During `lisa init`

```
$ lisa init

? How would you like to connect to Graphiti?
  ❯ Local Docker (runs Neo4j + Graphiti locally)
    Remote Neo4j (connect to Neo4j Aura or remote instance)
    Zep Cloud (managed Graphiti service)

[If Remote Neo4j selected]
? Neo4j URI (e.g., neo4j+s://xxxxx.databases.neo4j.io):
? Neo4j Username [neo4j]:
? Neo4j Password: ********
? OpenAI API Key (for embeddings): sk-********
? Graphiti MCP Endpoint [http://localhost:8010/mcp/]:

[If Zep Cloud selected]
? Zep API Key: zep_********
? Zep Project ID:

[Common for all]
? Group ID [<project-name>]: my-project

✓ Configuration saved to .agents/skills/.env
✓ Scaffolded .agents, .claude, .githooks
```

## Implementation Plan

### Phase 1: Add Interactive Prompts
**File: `src/cli.ts`**

1. Add `inquirer` dependency for interactive prompts
2. Create `promptDeploymentMode()` function:
   ```typescript
   type DeploymentMode = 'local' | 'remote-neo4j' | 'zep-cloud';

   async function promptDeploymentMode(): Promise<DeploymentMode>
   async function promptRemoteNeo4jConfig(): Promise<RemoteNeo4jConfig>
   async function promptZepCloudConfig(): Promise<ZepCloudConfig>
   ```

3. Modify `initCommand()` to call prompts when no flags provided

### Phase 2: Extend Configuration
**File: `src/lib/interfaces/IConfig.ts`** (new)

```typescript
interface IGraphitiConfig {
  mode: 'local' | 'remote-neo4j' | 'zep-cloud';
  endpoint: string;
  groupId: string;

  // Remote Neo4j specific
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  openaiApiKey?: string;

  // Zep Cloud specific
  zepApiKey?: string;
  zepProjectId?: string;
}
```

### Phase 3: Update .env Generation
**File: `src/cli.ts`**

Generate different `.env` content based on mode:

**Local mode:**
```env
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project
GRAPHITI_MODE=local
```

**Remote Neo4j mode:**
```env
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project
GRAPHITI_MODE=remote-neo4j
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=<encrypted-or-reference>
OPENAI_API_KEY=<encrypted-or-reference>
```

**Zep Cloud mode:**
```env
GRAPHITI_ENDPOINT=https://api.getzep.com/mcp/
GRAPHITI_GROUP_ID=my-project
GRAPHITI_MODE=zep-cloud
ZEP_API_KEY=<encrypted-or-reference>
ZEP_PROJECT_ID=<project-id>
```

### Phase 4: Docker Compose Variants
**New files:**
- `src/templates/docker/docker-compose.local.yml` - Full local stack (existing, renamed)
- `src/templates/docker/docker-compose.remote-neo4j.yml` - MCP only, connects to remote Neo4j

**Remote Neo4j compose (MCP server only):**
```yaml
services:
  graphiti-mcp:
    image: zepai/graphiti-mcp:latest
    ports:
      - "8010:8000"
    environment:
      - NEO4J_URI=${NEO4J_URI}
      - NEO4J_USER=${NEO4J_USER}
      - NEO4J_PASSWORD=${NEO4J_PASSWORD}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
```

### Phase 5: CLI Flag Support (Non-Interactive)
Allow skipping prompts with flags:

```bash
# Local (existing behavior)
lisa init

# Remote Neo4j via flags
lisa init --mode remote-neo4j \
  --neo4j-uri "neo4j+s://xxx.databases.neo4j.io" \
  --neo4j-user neo4j \
  --neo4j-password "***"

# Zep Cloud via flags
lisa init --mode zep-cloud --zep-api-key "zep_***"

# Skip prompts, use defaults
lisa init --yes
```

### Phase 6: Update `lisa doctor`
Extend health check for each mode:

- **Local**: Check Docker, Neo4j container, MCP endpoint
- **Remote Neo4j**: Check MCP endpoint, Neo4j connection
- **Zep Cloud**: Check Zep API reachability

## Files to Modify

| File | Changes |
|------|---------|
| `src/cli.ts` | Add prompts, new flags, mode-specific logic |
| `src/lib/interfaces/IConfig.ts` | New config interface |
| `src/lib/services.ts` | Add config validation service |
| `package.json` | Add `inquirer` dependency |
| `src/templates/docker/` | Add remote-neo4j compose variant |
| `src/templates/agents/skills/.env.example` | Show all config options |

## Security Considerations

1. **Sensitive values**: Don't store passwords in plain text
   - Option A: Reference environment variables (`${NEO4J_PASSWORD}`)
   - Option B: Use a secrets manager reference
   - Option C: Prompt at runtime (don't persist)

2. **Recommendation**: Store sensitive values as env var references:
   ```env
   NEO4J_PASSWORD=${NEO4J_PASSWORD}
   ```
   User sets actual value in shell or `.bashrc`

## Testing Strategy

1. **Unit tests**: Mock `inquirer` prompts, test config generation
2. **Integration tests**:
   - Test local mode (existing)
   - Test remote mode with mock Neo4j
   - Test Zep mode with mock API
3. **Manual testing**: Real Neo4j Aura instance, real Zep account

## Verification

After implementation:
```bash
# Test interactive flow
lisa init
# Select "Remote Neo4j", enter test credentials

# Verify config
cat .agents/skills/.env
# Should show NEO4J_URI, mode=remote-neo4j

# Test connection
lisa doctor
# Should show "Neo4j Aura: Connected" or similar

# Test memory works
node .agents/skills/memory/scripts/memory.js add "test" --cache
node .agents/skills/memory/scripts/memory.js load --cache
```

## Dependencies to Add

```json
{
  "dependencies": {
    "inquirer": "^9.2.0"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.0"
  }
}
```

## Rollout

1. Implement Phase 1-3 (core functionality)
2. Test with Neo4j Aura free tier
3. Implement Phase 4-6 (polish)
4. Update README with new options
5. Release as minor version bump (0.6.0)
