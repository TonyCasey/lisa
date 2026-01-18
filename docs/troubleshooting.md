# Troubleshooting

Common issues and solutions when using Lisa.

## Installation Issues

### "lisa: command not found"

**Cause:** Global npm install didn't add to PATH.

**Solutions:**

1. Verify installation:
   ```bash
   npm list -g @tonycasey/lisa
   ```

2. Check npm global bin directory:
   ```bash
   npm config get prefix
   ```
   Ensure `<prefix>/bin` is in your PATH.

3. Try reinstalling:
   ```bash
   npm uninstall -g @tonycasey/lisa
   npm install -g @tonycasey/lisa
   ```

4. On Windows, restart your terminal after installing.

### "Permission denied" during install

**Cause:** npm global directory requires elevated permissions.

**Solutions:**

1. Use a node version manager (nvm, fnm):
   ```bash
   nvm install 18
   nvm use 18
   npm install -g @tonycasey/lisa
   ```

2. Or fix npm permissions:
   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   export PATH=~/.npm-global/bin:$PATH
   ```

## Docker Issues

### "Cannot connect to Docker daemon"

**Cause:** Docker Desktop not running.

**Solution:** Start Docker Desktop, wait for it to fully initialize.

### "Port 7687 already in use"

**Cause:** Another Neo4j instance is running.

**Solutions:**

1. Stop other Neo4j instances
2. Or use a different port in `docker-compose.graphiti.yml`:
   ```yaml
   ports:
     - "7688:7687"
   ```

### "Container keeps restarting"

**Cause:** Usually insufficient resources or missing environment variables.

**Solutions:**

1. Check container logs:
   ```bash
   docker logs <container_id>
   ```

2. Verify `.env` file exists with required API keys

3. Increase Docker memory allocation (Docker Desktop > Settings > Resources)

## Connection Issues

### "MCP check failed"

**Cause:** Graphiti MCP server not reachable.

**Solutions:**

1. Check if containers are running:
   ```bash
   docker ps
   ```

2. Wait longer after `lisa up` (first start takes ~30-60 seconds)

3. Check container logs:
   ```bash
   docker logs graphiti-mcp
   ```

4. Verify endpoint in `.lisa/.env`:
   ```env
   GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
   ```

### "Connection refused to localhost:8010"

**Cause:** MCP server not started or wrong endpoint.

**Solutions:**

1. Run `lisa up` to start containers
2. Wait for startup to complete
3. Run `lisa doctor` to verify

### Zep Cloud "Unauthorized"

**Cause:** Invalid or missing API key.

**Solutions:**

1. Verify API key in `.lisa/.env`:
   ```env
   ZEP_API_KEY=your-actual-key
   ```

2. Check key hasn't expired in Zep dashboard

3. Verify project ID is correct

## Memory Issues

### "No memories found"

**Cause:** No memories saved yet, or wrong group ID.

**Solutions:**

1. Save some memories first:
   ```
   "remember that this project uses TypeScript"
   ```

2. Verify group ID matches:
   ```bash
   cat .lisa/.env | grep GROUP
   ```

3. Check MCP connectivity:
   ```bash
   lisa doctor
   ```

### Memories not persisting

**Cause:** MCP server connection issues.

**Solutions:**

1. Run `lisa doctor` to check connectivity
2. Check Docker containers are healthy
3. Verify Neo4j has enough disk space

## Skill Issues

### "Skill not found"

**Cause:** Skills not deployed or path incorrect.

**Solutions:**

1. Verify skills exist:
   ```bash
   ls -la .lisa/skills/
   ```

2. If using development install, rebuild:
   ```bash
   npm run build
   ```

3. Re-run setup:
   ```bash
   lisa setup -f
   ```

### "Script error" from skills

**Cause:** JavaScript execution error.

**Solutions:**

1. Run script directly to see error:
   ```bash
   node .lisa/skills/memory/scripts/memory.js load
   ```

2. Check Node.js version (18+ required)

3. Verify `.lisa/.env` configuration

## Reset Everything

If all else fails, start fresh:

```bash
# Remove Lisa artifacts
rm -rf .lisa .claude .codex
rm -f docker-compose.graphiti.yml .env.lisa.example

# Stop Docker containers
docker compose -f docker-compose.graphiti.yml down -v

# Re-initialize
lisa init -f
lisa up
```

## Getting Help

- Check [existing issues](https://github.com/tonycasey/lisa/issues)
- Open a new issue with:
  - Output of `lisa doctor`
  - Your OS and Node.js version
  - Steps to reproduce
  - Error messages
