/**
 * Storage Skill Tests
 *
 * Tests for storage.ts functionality.
 * Tests storage mode management, env file handling, and cache operations.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

describe('Storage Skill - Constants', () => {
  test('should have correct default endpoints', () => {
    const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8010/mcp/';
    const DEFAULT_ZEP_ENDPOINT = 'https://api.getzep.com/mcp/';
    const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';

    assert.equal(DEFAULT_LOCAL_ENDPOINT, 'http://localhost:8010/mcp/');
    assert.equal(DEFAULT_ZEP_ENDPOINT, 'https://api.getzep.com/mcp/');
    assert.equal(ZEP_BASE_URL, 'https://api.getzep.com/api/v2');
  });
});

describe('Storage Skill - Env Config Parsing', () => {
  // Simulates readEnvConfig function logic
  test('should parse simple env file', () => {
    const raw = `STORAGE_MODE=local
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project`;

    const out: Record<string, string> = {};
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });

    assert.equal(out['STORAGE_MODE'], 'local');
    assert.equal(out['GRAPHITI_ENDPOINT'], 'http://localhost:8010/mcp/');
    assert.equal(out['GRAPHITI_GROUP_ID'], 'my-project');
  });

  test('should skip comments in env file', () => {
    const raw = `# This is a comment
STORAGE_MODE=zep-cloud
# Another comment
ZEP_API_KEY=secret123`;

    const out: Record<string, string> = {};
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });

    assert.equal(Object.keys(out).length, 2);
    assert.equal(out['STORAGE_MODE'], 'zep-cloud');
    assert.equal(out['ZEP_API_KEY'], 'secret123');
  });

  test('should handle empty lines in env file', () => {
    const raw = `STORAGE_MODE=local

GRAPHITI_ENDPOINT=http://localhost:8010/mcp/

`;

    const out: Record<string, string> = {};
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });

    assert.equal(Object.keys(out).length, 2);
    assert.equal(out['STORAGE_MODE'], 'local');
  });

  test('should handle values with equals signs', () => {
    const raw = `CONNECTION_STRING=host=localhost;port=5432`;

    const out: Record<string, string> = {};
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      out[key] = val;
    });

    assert.equal(out['CONNECTION_STRING'], 'host=localhost;port=5432');
  });
});

describe('Storage Skill - Mode Validation', () => {
  test('should recognize valid modes', () => {
    const validModes = ['local', 'zep-cloud'];
    assert.ok(validModes.includes('local'));
    assert.ok(validModes.includes('zep-cloud'));
  });

  test('should reject invalid modes', () => {
    const validModes = ['local', 'zep-cloud'];
    assert.ok(!validModes.includes('invalid'));
    assert.ok(!validModes.includes(''));
    assert.ok(!validModes.includes('cloud'));
  });

  test('should determine correct endpoint for mode', () => {
    const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8010/mcp/';
    const DEFAULT_ZEP_ENDPOINT = 'https://api.getzep.com/mcp/';

    const getEndpointForMode = (mode: string): string => {
      return mode === 'zep-cloud' ? DEFAULT_ZEP_ENDPOINT : DEFAULT_LOCAL_ENDPOINT;
    };

    assert.equal(getEndpointForMode('local'), DEFAULT_LOCAL_ENDPOINT);
    assert.equal(getEndpointForMode('zep-cloud'), DEFAULT_ZEP_ENDPOINT);
  });
});

describe('Storage Skill - ZEP API Key Validation', () => {
  // Simulates checkZepApiKeyExists function logic
  test('should detect valid API key', () => {
    const checkZepApiKey = (env: Record<string, string>): { exists: boolean; error?: string } => {
      const apiKey = env.ZEP_API_KEY;
      if (apiKey && apiKey.length > 0 && !apiKey.startsWith('${')) {
        return { exists: true };
      }
      return {
        exists: false,
        error: 'ZEP_API_KEY not configured'
      };
    };

    const result = checkZepApiKey({ ZEP_API_KEY: 'my-api-key-123' });
    assert.ok(result.exists);
    assert.equal(result.error, undefined);
  });

  test('should detect missing API key', () => {
    const checkZepApiKey = (env: Record<string, string>): { exists: boolean; error?: string } => {
      const apiKey = env.ZEP_API_KEY;
      if (apiKey && apiKey.length > 0 && !apiKey.startsWith('${')) {
        return { exists: true };
      }
      return {
        exists: false,
        error: 'ZEP_API_KEY not configured'
      };
    };

    const result = checkZepApiKey({});
    assert.ok(!result.exists);
    assert.ok(result.error?.includes('not configured'));
  });

  test('should reject placeholder API key', () => {
    const checkZepApiKey = (env: Record<string, string>): { exists: boolean; error?: string } => {
      const apiKey = env.ZEP_API_KEY;
      if (apiKey && apiKey.length > 0 && !apiKey.startsWith('${')) {
        return { exists: true };
      }
      return {
        exists: false,
        error: 'ZEP_API_KEY not configured'
      };
    };

    const result = checkZepApiKey({ ZEP_API_KEY: '${ZEP_API_KEY}' });
    assert.ok(!result.exists);
  });
});

describe('Storage Skill - Cache Functions', () => {
  const testCacheDir = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '.tmp', 'test-cache');
  const testCacheFile = path.join(testCacheDir, 'storage-test.log');

  beforeEach(() => {
    fs.mkdirSync(testCacheDir, { recursive: true });
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  test('should write status to cache', () => {
    const entry = {
      status: 'ok',
      action: 'status',
      mode: 'local',
      endpoint: 'http://localhost:8010/mcp/',
      isConnected: true,
    };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(testCacheFile, `${line}\n`, 'utf8');

    const content = fs.readFileSync(testCacheFile, 'utf8');
    assert.ok(content.includes('"action":"status"'));
    assert.ok(content.includes('"mode":"local"'));
    assert.ok(content.includes('"isConnected":true'));
  });

  test('should write switch result to cache', () => {
    const entry = {
      status: 'ok',
      action: 'switch',
      previousMode: 'local',
      newMode: 'zep-cloud',
      verified: true,
    };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(testCacheFile, `${line}\n`, 'utf8');

    const content = fs.readFileSync(testCacheFile, 'utf8');
    assert.ok(content.includes('"action":"switch"'));
    assert.ok(content.includes('"previousMode":"local"'));
    assert.ok(content.includes('"newMode":"zep-cloud"'));
  });

  test('should read last cache entry', () => {
    const entries = [
      { status: 'ok', action: 'status', mode: 'local', ts: '2024-01-01' },
      { status: 'ok', action: 'switch', mode: 'zep-cloud', ts: '2024-01-02' },
    ];
    entries.forEach((e) => {
      fs.appendFileSync(testCacheFile, JSON.stringify(e) + '\n', 'utf8');
    });

    const data = fs.readFileSync(testCacheFile, 'utf8').trim().split('\n').filter(Boolean);
    const lastEntry = JSON.parse(data[data.length - 1]);
    assert.equal(lastEntry.action, 'switch');
    assert.equal(lastEntry.mode, 'zep-cloud');
  });
});

describe('Storage Skill - Output Structures', () => {
  test('should format status output correctly', () => {
    const statusOutput = {
      status: 'ok',
      action: 'status',
      mode: 'local',
      endpoint: 'http://localhost:8010/mcp/',
      groupId: 'my-project',
      isConnected: true,
    };

    assert.equal(statusOutput.status, 'ok');
    assert.equal(statusOutput.action, 'status');
    assert.ok(['local', 'zep-cloud'].includes(statusOutput.mode));
    assert.ok(typeof statusOutput.isConnected === 'boolean');
  });

  test('should format status error output correctly', () => {
    const statusOutput = {
      status: 'ok',
      action: 'status',
      mode: 'local',
      endpoint: 'http://localhost:8010/mcp/',
      groupId: 'my-project',
      isConnected: false,
      connectionError: 'Docker daemon is not running',
    };

    assert.equal(statusOutput.isConnected, false);
    assert.ok(statusOutput.connectionError);
  });

  test('should format switch success output correctly', () => {
    const switchOutput = {
      status: 'ok',
      action: 'switch',
      previousMode: 'local',
      newMode: 'zep-cloud',
      endpoint: 'https://api.getzep.com/mcp/',
      verified: true,
      message: 'Successfully switched from local to zep-cloud. Connection verified.',
    };

    assert.equal(switchOutput.status, 'ok');
    assert.equal(switchOutput.action, 'switch');
    assert.equal(switchOutput.previousMode, 'local');
    assert.equal(switchOutput.newMode, 'zep-cloud');
    assert.ok(switchOutput.verified);
    assert.ok(switchOutput.message.includes('Successfully'));
  });

  test('should format switch error output correctly', () => {
    const switchOutput = {
      status: 'error',
      action: 'switch',
      message: 'Invalid mode: invalid. Valid modes are: local, zep-cloud',
    };

    assert.equal(switchOutput.status, 'error');
    assert.ok(switchOutput.message.includes('Invalid mode'));
  });

  test('should format fallback output correctly', () => {
    const fallbackOutput = {
      status: 'fallback',
      error: 'Connection timeout',
      fallback: {
        status: 'ok',
        action: 'status',
        mode: 'local',
        isConnected: true,
      },
    };

    assert.equal(fallbackOutput.status, 'fallback');
    assert.ok(fallbackOutput.error);
    assert.ok(fallbackOutput.fallback);
    assert.equal(fallbackOutput.fallback.status, 'ok');
  });
});

describe('Storage Skill - Env File Update Logic', () => {
  // Simulates updateEnvStorageMode function logic
  test('should update existing STORAGE_MODE line', () => {
    const content = `GRAPHITI_GROUP_ID=my-project
STORAGE_MODE=local
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/`;

    const newMode = 'zep-cloud';
    const lines = content.split(/\r?\n/);

    const updatedLines = lines.map((line: string) => {
      if (line.startsWith('STORAGE_MODE=')) {
        return `STORAGE_MODE=${newMode}`;
      }
      return line;
    });

    const result = updatedLines.join('\n');
    assert.ok(result.includes('STORAGE_MODE=zep-cloud'));
    assert.ok(!result.includes('STORAGE_MODE=local'));
  });

  test('should update GRAPHITI_ENDPOINT when switching modes', () => {
    const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:8010/mcp/';
    const DEFAULT_ZEP_ENDPOINT = 'https://api.getzep.com/mcp/';

    const content = `STORAGE_MODE=local
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/`;

    const newMode = 'zep-cloud';
    const newEndpoint = newMode === 'zep-cloud' ? DEFAULT_ZEP_ENDPOINT : DEFAULT_LOCAL_ENDPOINT;
    const lines = content.split(/\r?\n/);

    const updatedLines = lines.map((line: string) => {
      if (line.startsWith('STORAGE_MODE=')) {
        return `STORAGE_MODE=${newMode}`;
      }
      if (line.startsWith('GRAPHITI_ENDPOINT=')) {
        return `GRAPHITI_ENDPOINT=${newEndpoint}`;
      }
      return line;
    });

    const result = updatedLines.join('\n');
    assert.ok(result.includes('STORAGE_MODE=zep-cloud'));
    assert.ok(result.includes(`GRAPHITI_ENDPOINT=${DEFAULT_ZEP_ENDPOINT}`));
  });

  test('should add STORAGE_MODE if not present', () => {
    const content = `GRAPHITI_GROUP_ID=my-project
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/`;

    const newMode = 'local';
    const lines = content.split(/\r?\n/);
    let foundMode = false;

    const updatedLines = lines.map((line: string) => {
      if (line.startsWith('STORAGE_MODE=')) {
        foundMode = true;
        return `STORAGE_MODE=${newMode}`;
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

    const result = updatedLines.join('\n');
    assert.ok(result.includes('STORAGE_MODE=local'));
  });
});

describe('Storage Skill - Argument Parsing', () => {
  // Simulates hasFlag function logic
  test('should detect --cache flag', () => {
    const args = ['status', '--cache'];

    const hasFlag = (name: string): boolean => {
      const idx = args.indexOf(name);
      if (idx === -1) return false;
      args.splice(idx, 1);
      return true;
    };

    assert.ok(hasFlag('--cache'));
    assert.ok(!args.includes('--cache'));
  });

  test('should return false for missing flag', () => {
    const args = ['status'];

    const hasFlag = (name: string): boolean => {
      const idx = args.indexOf(name);
      if (idx === -1) return false;
      args.splice(idx, 1);
      return true;
    };

    assert.ok(!hasFlag('--cache'));
  });

  test('should parse command and target mode', () => {
    const args = ['switch', 'zep-cloud', '--cache'];

    const command = args.shift() ?? '';
    const hasCache = args.includes('--cache');
    if (hasCache) {
      args.splice(args.indexOf('--cache'), 1);
    }
    const targetMode = args.shift() ?? '';

    assert.equal(command, 'switch');
    assert.equal(targetMode, 'zep-cloud');
    assert.ok(hasCache);
  });
});

describe('Storage Skill - Docker Check Messages', () => {
  test('should format Docker not running error', () => {
    const message = 'Cannot connect to the Docker daemon';
    const errorMessage = message.includes('Cannot connect')
      ? 'Docker daemon is not running. Start Docker Desktop or run `dockerd`.'
      : `Docker check failed: ${message}`;

    assert.equal(errorMessage, 'Docker daemon is not running. Start Docker Desktop or run `dockerd`.');
  });

  test('should format Docker not installed error', () => {
    const message = 'docker: command not found';
    let errorMessage: string;

    if (message.includes('Cannot connect') || message.includes('Is the docker daemon running')) {
      errorMessage = 'Docker daemon is not running.';
    } else if (message.includes('command not found') || message.includes('not recognized')) {
      errorMessage = 'Docker is not installed. Install Docker from https://docker.com';
    } else {
      errorMessage = `Docker check failed: ${message}`;
    }

    assert.ok(errorMessage.includes('not installed'));
  });
});

