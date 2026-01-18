/**
 * Storage service - manages Lisa storage mode (local/zep-cloud).
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export type StorageMode = 'local' | 'zep-cloud';

export interface IStorageStatus {
  status: 'ok';
  action: 'status';
  mode: string;
  endpoint: string;
  groupId: string;
  isConnected: boolean;
  connectionError?: string;
}

export interface IStorageSwitchResult {
  status: 'ok' | 'error';
  action: 'switch';
  previousMode?: string;
  newMode?: string;
  endpoint?: string;
  verified?: boolean;
  message: string;
  verifyError?: string;
}

export interface IStorageServiceDependencies {
  envPath: string;
  zepBaseUrl?: string;
  defaultLocalEndpoint?: string;
  defaultZepEndpoint?: string;
}

export interface IStorageService {
  readEnvConfig(): Record<string, string>;
  updateEnvStorageMode(newMode: StorageMode): void;
  checkDockerRunning(): { running: boolean; error?: string };
  checkZepApiKeyExists(env: Record<string, string>): { exists: boolean; error?: string };
  pingLocalMcp(endpoint: string): Promise<{ reachable: boolean; error?: string }>;
  pingZepCloud(apiKey: string): Promise<{ reachable: boolean; error?: string }>;
  getStatus(): Promise<IStorageStatus>;
  switchMode(newMode: StorageMode): Promise<IStorageSwitchResult>;
}

const DEFAULT_ZEP_BASE_URL = 'https://api.getzep.com/api/v2';
const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8010/mcp/';
const DEFAULT_ZEP_ENDPOINT = 'https://api.getzep.com/mcp/';

/**
 * Creates a storage service instance.
 */
export function createStorageService(deps: IStorageServiceDependencies): IStorageService {
  const {
    envPath,
    zepBaseUrl = DEFAULT_ZEP_BASE_URL,
    defaultLocalEndpoint = DEFAULT_LOCAL_ENDPOINT,
    defaultZepEndpoint = DEFAULT_ZEP_ENDPOINT,
  } = deps;

  const service: IStorageService = {
    readEnvConfig(): Record<string, string> {
      const out: Record<string, string> = {};
      try {
        const raw = fs.readFileSync(envPath, 'utf8');
        raw.split(/\r?\n/).forEach((line: string) => {
          if (!line || line.startsWith('#')) return;
          const idx = line.indexOf('=');
          if (idx === -1) return;
          out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
      } catch {
        // optional .env
      }
      return out;
    },

    updateEnvStorageMode(newMode: StorageMode): void {
      let content: string;
      try {
        content = fs.readFileSync(envPath, 'utf8');
      } catch {
        content = '';
      }

      const lines = content.split(/\r?\n/);
      let foundMode = false;
      let foundEndpoint = false;
      const newEndpoint = newMode === 'zep-cloud' ? defaultZepEndpoint : defaultLocalEndpoint;

      const updatedLines = lines.map((line: string) => {
        if (line.startsWith('STORAGE_MODE=') || line.startsWith('STORAGE_MODE =')) {
          foundMode = true;
          return `STORAGE_MODE=${newMode}`;
        }
        if (line.startsWith('GRAPHITI_ENDPOINT=') || line.startsWith('GRAPHITI_ENDPOINT =')) {
          foundEndpoint = true;
          return `GRAPHITI_ENDPOINT=${newEndpoint}`;
        }
        return line;
      });

      if (!foundMode) {
        const groupIdx = updatedLines.findIndex((l: string) => l.startsWith('GRAPHITI_GROUP_ID'));
        if (groupIdx !== -1) {
          updatedLines.splice(groupIdx + 1, 0, `STORAGE_MODE=${newMode}`);
        } else {
          updatedLines.push(`STORAGE_MODE=${newMode}`);
        }
      }

      if (!foundEndpoint) {
        const modeIdx = updatedLines.findIndex((l: string) => l.startsWith('STORAGE_MODE'));
        if (modeIdx !== -1) {
          updatedLines.splice(modeIdx + 1, 0, `GRAPHITI_ENDPOINT=${newEndpoint}`);
        } else {
          updatedLines.push(`GRAPHITI_ENDPOINT=${newEndpoint}`);
        }
      }

      fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');
    },

    checkDockerRunning(): { running: boolean; error?: string } {
      try {
        execSync('docker info', { stdio: 'pipe', timeout: 5000 });
        return { running: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Cannot connect') || message.includes('Is the docker daemon running')) {
          return { running: false, error: 'Docker daemon is not running.' };
        }
        if (message.includes('command not found') || message.includes('not recognized')) {
          return { running: false, error: 'Docker is not installed.' };
        }
        return { running: false, error: `Docker check failed: ${message}` };
      }
    },

    checkZepApiKeyExists(env: Record<string, string>): { exists: boolean; error?: string } {
      const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY;
      if (apiKey && apiKey.length > 0 && !apiKey.startsWith('${')) {
        return { exists: true };
      }
      return { exists: false, error: 'ZEP_API_KEY not configured.' };
    },

    async pingLocalMcp(endpoint: string): Promise<{ reachable: boolean; error?: string }> {
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
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) return { reachable: true };
        return { reachable: false, error: `HTTP ${resp.status}` };
      } catch (err: unknown) {
        return { reachable: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async pingZepCloud(apiKey: string): Promise<{ reachable: boolean; error?: string }> {
      try {
        const resp = await fetch(`${zepBaseUrl}/users`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok || resp.status === 404 || resp.status === 400) return { reachable: true };
        if (resp.status === 401 || resp.status === 403) return { reachable: false, error: 'Invalid API key' };
        return { reachable: false, error: `HTTP ${resp.status}` };
      } catch (err: unknown) {
        return { reachable: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async getStatus(): Promise<IStorageStatus> {
      const env = service.readEnvConfig();
      const mode = env.STORAGE_MODE || process.env.STORAGE_MODE || 'local';
      const endpoint = env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || defaultLocalEndpoint;
      const groupId = env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || 'lisa';

      let isConnected = false;
      let connectionError: string | undefined;

      if (mode === 'zep-cloud') {
        const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
        if (apiKey && !apiKey.startsWith('${')) {
          const result = await service.pingZepCloud(apiKey);
          isConnected = result.reachable;
          connectionError = result.error;
        } else {
          connectionError = 'ZEP_API_KEY not configured';
        }
      } else if (mode === 'local') {
        const dockerCheck = service.checkDockerRunning();
        if (!dockerCheck.running) {
          connectionError = dockerCheck.error;
        } else {
          const result = await service.pingLocalMcp(endpoint);
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
    },

    async switchMode(newMode: StorageMode): Promise<IStorageSwitchResult> {
      const validModes: StorageMode[] = ['local', 'zep-cloud'];
      if (!validModes.includes(newMode)) {
        return {
          status: 'error',
          action: 'switch',
          message: `Invalid mode: ${newMode}. Valid: ${validModes.join(', ')}`,
        };
      }

      const env = service.readEnvConfig();
      const previousMode = env.STORAGE_MODE || process.env.STORAGE_MODE || 'local';

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

      // Validation
      if (newMode === 'local') {
        const dockerCheck = service.checkDockerRunning();
        if (!dockerCheck.running) {
          return { status: 'error', action: 'switch', message: `Cannot switch to local: ${dockerCheck.error}` };
        }
      } else if (newMode === 'zep-cloud') {
        const zepCheck = service.checkZepApiKeyExists(env);
        if (!zepCheck.exists) {
          return { status: 'error', action: 'switch', message: `Cannot switch to zep-cloud: ${zepCheck.error}` };
        }
      }

      service.updateEnvStorageMode(newMode);

      const updatedEnv = service.readEnvConfig();
      const newEndpoint = updatedEnv.GRAPHITI_ENDPOINT || (newMode === 'zep-cloud' ? defaultZepEndpoint : defaultLocalEndpoint);

      let verified = false;
      let verifyError: string | undefined;

      if (newMode === 'zep-cloud') {
        const apiKey = updatedEnv.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
        const result = await service.pingZepCloud(apiKey);
        verified = result.reachable;
        verifyError = result.error;
      } else {
        const result = await service.pingLocalMcp(newEndpoint);
        verified = result.reachable;
        verifyError = result.error;
      }

      const message = verified
        ? `Switched from ${previousMode} to ${newMode}. Connection verified.`
        : `Switched from ${previousMode} to ${newMode}, but verification failed: ${verifyError}`;

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
    },
  };

  return service;
}
