# Storage Setup Guide

## Overview

Lisa uses a graph database (Neo4j) to store persistent memory. This enables Lisa to remember context across sessions, track project history, and provide intelligent assistance based on past interactions.

There are three storage options available:

| Option | Best For | Requirements |
|--------|----------|--------------|
| **Local Docker** | Development, testing | Docker Desktop |
| **Zep Cloud** | Managed service, easiest setup | Zep Cloud account |

---

## Option 1: Local Docker (Recommended for Development)

Run Neo4j and the Zep (Graphiti) MCP server locally using Docker.

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

## Option 2: Zep Cloud (Fully Managed)

Use Zep's managed service for production.

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
| `STORAGE_MODE` | all | Storage mode: `local`, `zep-cloud`, or `skip` |
| `GRAPHITI_ENDPOINT` | local | MCP server endpoint URL (not needed for zep-cloud) |
| `GRAPHITI_GROUP_ID` | all | Memory group identifier (usually project name) |
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

### "Invalid API key" (Zep Cloud)
- Verify the API key is correct
- Check the project ID matches your Zep project
- Ensure your Zep account is active

---

## Getting Help

- Run `lisa --help` for command options
- Check [github.com/TonyCasey/lisa](https://github.com/TonyCasey/lisa) for updates
- Report issues at the GitHub repository
