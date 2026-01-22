/**
 * Utility functions for hook handlers.
 * Handles stdin/stdout communication with Claude Code.
 */

import { Readable, Writable } from 'stream';

const STDIN_TIMEOUT_MS = 100;

/**
 * Read JSON input from stdin with timeout.
 */
export async function readJsonStdin<T>(stdin: Readable = process.stdin): Promise<T> {
  return new Promise((resolve) => {
    let input = '';

    const timeout = setTimeout(() => {
      resolve({} as T);
    }, STDIN_TIMEOUT_MS);

    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      input += chunk;
    });

    stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(input) as T);
      } catch {
        resolve({} as T);
      }
    });

    // Handle case where stdin is already closed
    if ('readableEnded' in stdin && stdin.readableEnded) {
      clearTimeout(timeout);
      resolve({} as T);
    }
  });
}

/**
 * Write output to stdout.
 */
export async function writeJsonStdout<T>(
  data: T,
  stdout: Writable = process.stdout
): Promise<void> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const flushed = stdout.write(json);
    if (flushed) {
      resolve();
      return;
    }
    stdout.once('drain', resolve);
    stdout.once('error', reject);
  });
}

/**
 * Write text to a stream, handling backpressure.
 */
export async function writeToStream(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve) => {
    const flushed = stream.write(text);
    if (flushed) {
      resolve();
      return;
    }
    stream.once('drain', resolve);
  });
}

/**
 * Get environment configuration for hooks.
 * Reads from environment variables (set via .lisa/.env).
 */
export function getHookConfig(): {
  endpoint: string;
  groupId: string;
  storageMode: string;
  zepApiKey: string;
} {
  return {
    endpoint: process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/',
    groupId: process.env.GRAPHITI_GROUP_ID || getProjectName(),
    storageMode: process.env.STORAGE_MODE || 'local',
    zepApiKey: process.env.ZEP_API_KEY || '',
  };
}

/**
 * Get project name from package.json or directory name.
 */
function getProjectName(): string {
  try {
    const fs = require('fs');
    const path = require('path');
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch {
    // Ignore errors
  }
  const path = require('path');
  return path.basename(process.cwd());
}

/**
 * Detect git repository name.
 */
export function detectRepo(): string {
  try {
    const { execSync } = require('child_process');
    const url = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    // Extract repo name from git URL
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : getProjectName();
  } catch {
    return getProjectName();
  }
}

/**
 * Detect git branch name.
 */
export function detectBranch(): string | null {
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current 2>/dev/null', { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get current user name.
 */
export function getUserName(): string {
  return process.env.USER || process.env.USERNAME || 'unknown';
}

/**
 * Get hierarchical group IDs based on folder structure.
 */
export function getHierarchicalGroupIds(): string[] {
  const projectName = getProjectName();
  const repo = detectRepo();
  const ids = new Set<string>();
  
  ids.add(projectName);
  if (repo && repo !== projectName) {
    ids.add(repo);
  }
  
  return Array.from(ids);
}
