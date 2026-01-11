#!/usr/bin/env node
// Lisa storage mode management script.
// Commands:
//   node storage.js status [--cache]         Show current storage mode and connection status
//   node storage.js switch <mode> [--cache]  Switch to local or zep-cloud mode
// Options:
//   --cache  Write successful responses to cache and use as fallback on errors.

export {}; // ensure module scope to prevent global collisions across templates

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Constants
const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';
const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8010/mcp/';
const DEFAULT_ZEP_ENDPOINT = 'https://api.getzep.com/mcp/';

// Read environment config from .agents/skills/.env
function readEnvConfig(): Record<string, string> {
  // Path: .agents/skills/lisa/scripts/ -> .agents/skills/.env (2 levels up)
  const envPath = path.join(__dirname, '..', '..', '.env');
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });
  } catch (_) {
    // optional .env; ignore if missing
  }
  return out;
}

// Update STORAGE_MODE in .agents/skills/.env (preserves comments and other vars)
function updateEnvStorageMode(newMode: string): void {
  const envPath = path.join(__dirname, '..', '..', '.env');
  let content: string;

  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch (_) {
    // Create new .env if it doesn't exist
    content = '';
  }

  const lines = content.split(/\r?\n/);
  let foundMode = false;
  let foundEndpoint = false;

  const newEndpoint = newMode === 'zep-cloud' ? DEFAULT_ZEP_ENDPOINT : DEFAULT_LOCAL_ENDPOINT;

  const updatedLines = lines.map((line: string) => {
    // Update STORAGE_MODE
    if (line.startsWith('STORAGE_MODE=') || line.startsWith('STORAGE_MODE =')) {
      foundMode = true;
      return `STORAGE_MODE=${newMode}`;
    }
    // Update GRAPHITI_ENDPOINT
    if (line.startsWith('GRAPHITI_ENDPOINT=') || line.startsWith('GRAPHITI_ENDPOINT =')) {
      foundEndpoint = true;
      return `GRAPHITI_ENDPOINT=${newEndpoint}`;
    }
    return line;
  });

  // Add STORAGE_MODE if not found
  if (!foundMode) {
    // Find a good place to insert (after GRAPHITI_GROUP_ID or at end)
    const groupIdx = updatedLines.findIndex((l: string) => l.startsWith('GRAPHITI_GROUP_ID'));
    if (groupIdx !== -1) {
      updatedLines.splice(groupIdx + 1, 0, `STORAGE_MODE=${newMode}`);
    } else {
      updatedLines.push(`STORAGE_MODE=${newMode}`);
    }
  }

  // Add GRAPHITI_ENDPOINT if not found
  if (!foundEndpoint) {
    const modeIdx = updatedLines.findIndex((l: string) => l.startsWith('STORAGE_MODE'));
    if (modeIdx !== -1) {
      updatedLines.splice(modeIdx + 1, 0, `GRAPHITI_ENDPOINT=${newEndpoint}`);
    } else {
      updatedLines.push(`GRAPHITI_ENDPOINT=${newEndpoint}`);
    }
  }

  // Write back
  fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');
}

// Check if Docker daemon is running
function checkDockerRunning(): { running: boolean; error?: string } {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return { running: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Cannot connect') || message.includes('Is the docker daemon running')) {
      return { running: false, error: 'Docker daemon is not running. Start Docker Desktop or run `dockerd`.' };
    }
    if (message.includes('command not found') || message.includes('not recognized')) {
      return { running: false, error: 'Docker is not installed. Install Docker from https://docker.com' };
    }
    return { running: false, error: `Docker check failed: ${message}` };
  }
}

// Check if ZEP_API_KEY exists
function checkZepApiKeyExists(env: Record<string, string>): { exists: boolean; error?: string } {
  const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY;
  if (apiKey && apiKey.length > 0 && !apiKey.startsWith('${')) {
    return { exists: true };
  }
  return {
    exists: false,
    error: 'ZEP_API_KEY not configured. Add ZEP_API_KEY to .agents/.env or set it as an environment variable.'
  };
}

// Ping local MCP endpoint
async function pingLocalMcp(endpoint: string): Promise<{ reachable: boolean; error?: string }> {
  try {
    const body = {
      jsonrpc: '2.0',
      id: 'ping',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'storage-skill', version: '0.1.0' },
      },
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (resp.ok) {
      return { reachable: true };
    }
    return { reachable: false, error: `HTTP ${resp.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: message };
  }
}

// Ping Zep Cloud API
async function pingZepCloud(apiKey: string): Promise<{ reachable: boolean; error?: string }> {
  try {
    const resp = await fetch(`${ZEP_BASE_URL}/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    // Even 404 or 400 means the API is reachable and auth worked
    if (resp.ok || resp.status === 404 || resp.status === 400) {
      return { reachable: true };
    }
    if (resp.status === 401 || resp.status === 403) {
      return { reachable: false, error: 'Invalid API key' };
    }
    return { reachable: false, error: `HTTP ${resp.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: message };
  }
}

// Argument parsing
const args: string[] = process.argv.slice(2);

function popFlag(name: string, fallback: string): string;
function popFlag(name: string, fallback: null): string | null;
function popFlag(name: string, fallback: string | null): string | null {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val ?? fallback;
}

function hasFlag(name: string): boolean {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

const command = args.shift() ?? '';
const useCache = hasFlag('--cache');
const targetMode = args.shift() ?? '';

const cacheFile = path.join(__dirname, '..', 'cache', 'storage.log');

function writeCache(obj: Record<string, unknown>): void {
  try {
    const cacheDir = path.dirname(cacheFile);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
    fs.appendFileSync(cacheFile, `${line}\n`, 'utf8');
  } catch (_) {
    // cache failures should not crash command
  }
}

function readCacheFallback(): Record<string, unknown> | null {
  try {
    const data = fs.readFileSync(cacheFile, 'utf8').trim().split('\n').filter(Boolean);
    if (!data.length) return null;
    return data.slice(-1).map((l: string) => JSON.parse(l))[0] as Record<string, unknown>;
  } catch (_) {
    return null;
  }
}

// Status command
async function statusCommand(): Promise<Record<string, unknown>> {
  const env = readEnvConfig();
  const mode = env.STORAGE_MODE || process.env.STORAGE_MODE || 'local';
  const endpoint = env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || DEFAULT_LOCAL_ENDPOINT;
  const groupId = env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || 'lisa';

  let isConnected = false;
  let connectionError: string | undefined;

  if (mode === 'zep-cloud') {
    const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
    if (apiKey && !apiKey.startsWith('${')) {
      const result = await pingZepCloud(apiKey);
      isConnected = result.reachable;
      connectionError = result.error;
    } else {
      connectionError = 'ZEP_API_KEY not configured';
    }
  } else if (mode === 'local') {
    const dockerCheck = checkDockerRunning();
    if (!dockerCheck.running) {
      connectionError = dockerCheck.error;
    } else {
      const result = await pingLocalMcp(endpoint);
      isConnected = result.reachable;
      connectionError = result.error;
    }
  } else {
    connectionError = `Unknown mode: ${mode}`;
  }

  return {
    status: 'ok',
    action: 'status',
    mode,
    endpoint,
    groupId,
    isConnected,
    ...(connectionError ? { connectionError } : {}),
  };
}

// Switch command
async function switchCommand(newMode: string): Promise<Record<string, unknown>> {
  const validModes = ['local', 'zep-cloud'];
  if (!validModes.includes(newMode)) {
    return {
      status: 'error',
      action: 'switch',
      message: `Invalid mode: ${newMode}. Valid modes are: ${validModes.join(', ')}`,
    };
  }

  const env = readEnvConfig();
  const previousMode = env.STORAGE_MODE || process.env.STORAGE_MODE || 'local';

  // Same mode check
  if (previousMode === newMode) {
    return {
      status: 'ok',
      action: 'switch',
      previousMode,
      newMode,
      verified: true,
      message: `Already using ${newMode} mode.`,
    };
  }

  // Validation before switching
  if (newMode === 'local') {
    const dockerCheck = checkDockerRunning();
    if (!dockerCheck.running) {
      return {
        status: 'error',
        action: 'switch',
        message: `Cannot switch to local: ${dockerCheck.error}`,
      };
    }
  } else if (newMode === 'zep-cloud') {
    const zepCheck = checkZepApiKeyExists(env);
    if (!zepCheck.exists) {
      return {
        status: 'error',
        action: 'switch',
        message: `Cannot switch to zep-cloud: ${zepCheck.error}`,
      };
    }
  }

  // Update the .env file
  updateEnvStorageMode(newMode);

  // Re-read config to get updated endpoint
  const updatedEnv = readEnvConfig();
  const newEndpoint = updatedEnv.GRAPHITI_ENDPOINT || (newMode === 'zep-cloud' ? DEFAULT_ZEP_ENDPOINT : DEFAULT_LOCAL_ENDPOINT);

  // Verify connection after switch
  let verified = false;
  let verifyError: string | undefined;

  if (newMode === 'zep-cloud') {
    const apiKey = updatedEnv.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
    const result = await pingZepCloud(apiKey);
    verified = result.reachable;
    verifyError = result.error;
  } else {
    const result = await pingLocalMcp(newEndpoint);
    verified = result.reachable;
    verifyError = result.error;
  }

  const message = verified
    ? `Successfully switched from ${previousMode} to ${newMode}. Connection verified.`
    : `Switched from ${previousMode} to ${newMode}, but connection verification failed: ${verifyError}`;

  return {
    status: 'ok',
    action: 'switch',
    previousMode,
    newMode,
    endpoint: newEndpoint,
    verified,
    message,
    ...(verifyError && !verified ? { verifyError } : {}),
  };
}

async function main(): Promise<void> {
  try {
    if (!['status', 'switch'].includes(command)) {
      throw new Error('command must be status|switch');
    }

    let out: Record<string, unknown>;

    if (command === 'status') {
      out = await statusCommand();
    } else {
      // switch
      if (!targetMode) {
        throw new Error('switch requires a mode argument (local or zep-cloud)');
      }
      out = await switchCommand(targetMode);
    }

    if (useCache && out.status === 'ok') {
      writeCache(out);
    }

    console.log(JSON.stringify(out, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = useCache ? readCacheFallback() : null;
    if (fallback) {
      console.log(JSON.stringify({ status: 'fallback', error: message, fallback }, null, 2));
      return;
    }
    console.error(message);
    process.exit(1);
  }
}

main();
