# Storage Setup Guide

## Overview

Lisa uses a graph database (Neo4j) to store persistent memory. This enables Lisa to remember context across sessions, track project history, and provide intelligent assistance based on past interactions.

There are three storage options available:

| Option | Best For | Requirements |
|--------|----------|--------------|
| **Local Docker** | Development, testing | Docker Desktop |
| **Remote Neo4j** | Production, team sharing | Neo4j Aura account + OpenAI API key |
| **Zep Cloud** | Managed service, easiest setup | Zep Cloud account |

---

## Option 1: Local Docker (Recommended for Development)

Run Neo4j and the MCP server locally using Docker.

### Prerequisites
- Docker Desktop installed and running
- At least 4GB RAM available for containers

### Setup Steps

1. **Initialize with local mode:**
   ```bash
   lisa init --mode local
   ```

2. **Start the services:**
   ```bash
   lisa up
   ```

3. **Verify the connection:**
   ```bash
   lisa doctor
   ```

### What Gets Started
- **Neo4j** - Graph database on port 7474 (browser) and 7687 (bolt)
- **MCP Server** - Memory API on port 8010

### Stopping Services
```bash
lisa down
```

---

## Option 2: Remote Neo4j (Neo4j Aura)

Connect to a cloud-hosted Neo4j instance. Great for production or team environments.

### Prerequisites
- Neo4j Aura account (free tier available at [neo4j.com/aura](https://neo4j.com/aura))
- OpenAI API key for embeddings ([platform.openai.com](https://platform.openai.com))

### Setup Steps

1. **Create a Neo4j Aura instance:**
   - Go to [console.neo4j.io](https://console.neo4j.io)
   - Create a new AuraDB Free instance
   - Copy the connection URI (looks like `neo4j+s://xxxxx.databases.neo4j.io`)
   - Save the generated password

2. **Initialize with remote-neo4j mode:**
   ```bash
   lisa init --mode remote-neo4j
   ```

3. **Enter connection details when prompted:**
   - Neo4j URI
   - Neo4j username (usually `neo4j`)
   - Neo4j password
   - OpenAI API key

4. **Start the local MCP server:**
   ```bash
   lisa up
   ```

5. **Verify the connection:**
   ```bash
   lisa doctor
   ```

### Security Note
Credentials are stored in `.agents/.env.local` which should be added to `.gitignore`.

---

## Option 3: Zep Cloud (Fully Managed)

Use Zep's managed service for the easiest setup with no local infrastructure.

### Prerequisites
- Zep Cloud account (sign up at [getzep.com](https://getzep.com))

### Setup Steps

1. **Create a Zep project:**
   - Go to [cloud.getzep.com](https://cloud.getzep.com)
   - Create a new project
   - Copy your API key (starts with `z_`)

2. **Initialize with zep-cloud mode:**
   ```bash
   lisa init --mode zep-cloud
   ```

3. **Enter Zep API key when prompted**

4. **Verify the connection:**
   ```bash
   lisa doctor
   ```

### How It Works
- **No Docker required** - Lisa connects directly to Zep's REST API
- **No MCP server** - Uses Zep's native `/api/v2` endpoints
- **Free tier** - 1,000 episodes/month, unlimited storage

---

## Manual Configuration

If you chose "Set up later" during initialization, follow these steps:

1. **Edit the environment file:**
   ```bash
   nano .agents/.env
   ```

2. **Uncomment and configure your chosen option:**

   **For Local Docker:**
   ```env
   STORAGE_MODE=local
   GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
   GRAPHITI_GROUP_ID=your-project-name
   ```

   **For Remote Neo4j:**
   ```env
   STORAGE_MODE=remote-neo4j
   GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
   GRAPHITI_GROUP_ID=your-project-name
   NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your-password
   OPENAI_API_KEY=sk-xxxxx
   ```

   **For Zep Cloud:**
   ```env
   STORAGE_MODE=zep-cloud
   GRAPHITI_GROUP_ID=your-project-name
   ZEP_API_KEY=z_xxxxx
   ```
   Note: No endpoint needed - Lisa uses Zep's native REST API directly.

3. **Start a new terminal session** (to load new environment variables)

4. **Run `lisa doctor`** to verify the connection

---

## Environment Variables Reference

| Variable | Mode | Description |
|----------|------|-------------|
| `STORAGE_MODE` | all | Storage mode: `local`, `remote-neo4j`, `zep-cloud`, or `skip` |
| `GRAPHITI_ENDPOINT` | local, remote-neo4j | MCP server endpoint URL (not needed for zep-cloud) |
| `GRAPHITI_GROUP_ID` | all | Memory group identifier (usually project name) |
| `NEO4J_URI` | remote-neo4j | Neo4j connection URI |
| `NEO4J_USER` | remote-neo4j | Neo4j username |
| `NEO4J_PASSWORD` | remote-neo4j | Neo4j password |
| `OPENAI_API_KEY` | remote-neo4j | OpenAI API key for embeddings |
| `ZEP_API_KEY` | zep-cloud | Zep Cloud API key (starts with `z_`) |

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `lisa init` | Initialize Lisa in a project |
| `lisa up` | Start local Docker services |
| `lisa down` | Stop local Docker services |
| `lisa doctor` | Check storage connection status |

---

## Troubleshooting

### `lisa doctor` shows "Docker missing or not running"
- Ensure Docker Desktop is installed and running
- On macOS: Check the Docker icon in the menu bar
- On Linux: Run `sudo systemctl start docker`

### "MCP check failed" error
- Verify the endpoint URL is correct
- For local mode: Ensure `lisa up` has been run
- Check that port 8010 is not blocked by firewall

### "Neo4j connection failed" (remote mode)
- Verify Neo4j URI is correct (should start with `neo4j+s://`)
- Check username and password
- Ensure the Aura instance is running (not paused)

### "Invalid API key" (Zep Cloud)
- Verify the API key is correct
- Check the project ID matches your Zep project
- Ensure your Zep account is active

---

## Getting Help

- Run `lisa --help` for command options
- Check [github.com/your-repo/lisa](https://github.com/your-repo/lisa) for updates
- Report issues at the GitHub repository
