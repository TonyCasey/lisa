/**
 * Graphiti Writer - Write memories to Graphiti MCP
 *
 * Provides sync and async methods for storing memories via the lisa CLI.
 * Handles availability checking, timeouts, and error handling.
 */

import type { IGraphitiResult } from '../core/types';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// =============================================================================
// Configuration
// =============================================================================

/** Default timeout for Graphiti operations (ms) */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Timeout for async operations (ms) */
export const ASYNC_TIMEOUT_MS = 10000;

/** Default Graphiti endpoint */
export const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for writing to Graphiti via lisa CLI
 */
export interface IMemoryWriteOptions {
  /** The fact/memory text to store */
  fact: string;
  /** Group ID for the memory (usually repo name) */
  group?: string;
  /** Tags to attach to the memory */
  tags?: string[];
  /** Source identifier (e.g., 'session-stop', 'user-prompt') */
  source?: string;
  /** Working directory for the memory skill */
  cwd?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Use cache for faster writes */
  cache?: boolean;
}

/**
 * Options for writing prompts to Graphiti
 */
export interface IPromptWriteOptions {
  /** The prompt text */
  text: string;
  /** Role (usually 'user') */
  role?: string;
  /** Source identifier */
  source?: string;
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

// =============================================================================
// CLI Helpers
// =============================================================================

/**
 * Check if lisa CLI is available
 */
export function isLisaAvailable(): boolean {
  try {
    execSync('lisa --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Availability Check
// =============================================================================

/**
 * Check if Graphiti MCP server is available
 *
 * @param endpoint - Graphiti endpoint URL
 * @param timeoutMs - Timeout for the check
 * @returns True if server responds
 */
export async function isGraphitiAvailable(
  endpoint: string = DEFAULT_ENDPOINT,
  timeoutMs: number = 2000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'health',
        method: 'ping',
        params: {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    // 400 means server is up but method not found - still available
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/**
 * Read Graphiti endpoint from environment or .env file
 */
export function getGraphitiEndpoint(cwd: string = process.cwd()): string {
  // Check environment variable first
  if (process.env.GRAPHITI_ENDPOINT) {
    return process.env.GRAPHITI_ENDPOINT;
  }

  // Try to read from .lisa/.env file
  const envPath = path.join(cwd, '.lisa', '.env');
  try {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('GRAPHITI_ENDPOINT=')) {
          return line.slice('GRAPHITI_ENDPOINT='.length).trim();
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return DEFAULT_ENDPOINT;
}

// =============================================================================
// Memory Writing (via lisa CLI)
// =============================================================================

/**
 * Write a memory to Graphiti via the lisa CLI (blocking)
 *
 * @param options - Write options
 * @returns Result of the write operation
 */
export async function writeMemory(options: IMemoryWriteOptions): Promise<IGraphitiResult> {
  const {
    fact,
    group = 'agent-memories',
    tags = [],
    source,
    cwd = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cache = true,
  } = options;

  if (!isLisaAvailable()) {
    return { status: 'error', error: 'Lisa CLI not found' };
  }

  return new Promise((resolve) => {
    let resolved = false;

    const safeResolve = (result: IGraphitiResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Build arguments for lisa memory add
    const args = ['memory', 'add', fact, '--group', group];

    for (const tag of tags) {
      args.push('--tag', tag);
    }

    if (source) {
      args.push('--source', source);
    }

    if (cache) {
      args.push('--cache');
    }

    const child = spawn('lisa', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as IGraphitiResult;
          safeResolve(result);
        } catch {
          safeResolve({ status: 'ok', raw: stdout.trim() });
        }
      } else {
        const errorMsg = stderr.trim() || `exit code ${code}`;
        if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED')) {
          safeResolve({ status: 'unavailable' });
        } else {
          safeResolve({ status: 'error', error: errorMsg });
        }
      }
    });

    child.on('error', (err: Error) => {
      if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
        safeResolve({ status: 'unavailable' });
      } else {
        safeResolve({ status: 'error', error: err.message });
      }
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      try {
        child.kill();
      } catch {
        // Ignore kill errors
      }
      safeResolve({ status: 'timeout' });
    }, timeoutMs);

    child.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Write a memory to Graphiti asynchronously (fire-and-forget)
 *
 * Spawns a detached process and returns immediately.
 * Use this when you don't want to block on the write.
 *
 * @param options - Write options
 */
export function writeMemoryAsync(options: IMemoryWriteOptions): void {
  const {
    fact,
    group = 'agent-memories',
    tags = [],
    source,
    cwd = process.cwd(),
    cache = true,
  } = options;

  if (!isLisaAvailable()) {
    return; // Silently skip
  }

  try {
    // Build arguments for lisa memory add
    const args = ['memory', 'add', fact, '--group', group];

    for (const tag of tags) {
      args.push('--tag', tag);
    }

    if (source) {
      args.push('--source', source);
    }

    if (cache) {
      args.push('--cache');
    }

    const child = spawn('lisa', args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: true,
    });

    child.unref();
  } catch {
    // Silently ignore spawn errors
  }
}

// =============================================================================
// Prompt Writing (via lisa CLI)
// =============================================================================

/**
 * Write a prompt to Graphiti via the lisa CLI (blocking)
 *
 * @param options - Write options
 * @returns Result of the write operation
 */
export async function writePrompt(options: IPromptWriteOptions): Promise<IGraphitiResult> {
  const {
    text,
    role = 'user',
    source = 'user-prompt',
    cwd = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!isLisaAvailable()) {
    return { status: 'error', error: 'Lisa CLI not found' };
  }

  // Check availability first
  const endpoint = getGraphitiEndpoint(cwd);
  const available = await isGraphitiAvailable(endpoint);
  if (!available) {
    return { status: 'unavailable' };
  }

  return new Promise((resolve) => {
    let resolved = false;

    const safeResolve = (result: IGraphitiResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Build arguments for lisa prompt add
    const args = ['prompt', 'add', '--text', text, '--role', role, '--source', source];

    const child = spawn('lisa', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as IGraphitiResult;
          safeResolve(result);
        } catch {
          safeResolve({ status: 'ok', raw: stdout.trim() });
        }
      } else {
        const errorMsg = stderr.trim() || `exit code ${code}`;
        if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED')) {
          safeResolve({ status: 'unavailable' });
        } else {
          safeResolve({ status: 'error', error: errorMsg });
        }
      }
    });

    child.on('error', (err: Error) => {
      safeResolve({ status: 'error', error: err.message });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      try {
        child.kill();
      } catch {
        // Ignore kill errors
      }
      safeResolve({ status: 'timeout' });
    }, timeoutMs);

    child.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Write a prompt to Graphiti asynchronously (fire-and-forget)
 *
 * @param options - Write options
 */
export function writePromptAsync(options: IPromptWriteOptions): void {
  const {
    text,
    role = 'user',
    source = 'user-prompt',
    cwd = process.cwd(),
  } = options;

  if (!isLisaAvailable()) {
    return; // Silently skip
  }

  try {
    // Build arguments for lisa prompt add
    const args = ['prompt', 'add', '--text', text, '--role', role, '--source', source];

    const child = spawn('lisa', args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: true,
    });

    child.unref();
  } catch {
    // Silently ignore spawn errors
  }
}
