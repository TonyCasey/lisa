/**
 * Shared CLI Runner for Skill Integration Tests
 *
 * Provides utilities for executing skill scripts and parsing JSON output.
 * Automatically loads environment variables from root .env file.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import type { ICliRunnerOptions, ICliResult } from './types';

const execAsync = promisify(exec);

// Load environment variables from root .env file
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

// Cache loaded env vars for passing to child processes
const loadedEnv: Record<string, string> = {};
if (process.env.ZEP_API_KEY) {
  loadedEnv.ZEP_API_KEY = process.env.ZEP_API_KEY;
}
if (process.env.STORAGE_MODE) {
  loadedEnv.STORAGE_MODE = process.env.STORAGE_MODE;
}
if (process.env.GRAPHITI_ENDPOINT) {
  loadedEnv.GRAPHITI_ENDPOINT = process.env.GRAPHITI_ENDPOINT;
}

/**
 * Find skill script path (supports .js and .cjs extensions)
 *
 * @param skillName - Name of the skill (e.g., 'memory', 'tasks')
 * @returns Full path to script or null if not found
 */
export function findSkillScript(skillName: string): string | null {
  const basePaths = [
    path.join(projectRoot, '.lisa', 'skills', skillName, 'scripts', `${skillName}.js`),
    path.join(projectRoot, '.lisa', 'skills', skillName, 'scripts', `${skillName}.cjs`),
  ];

  for (const scriptPath of basePaths) {
    if (fs.existsSync(scriptPath)) {
      return scriptPath;
    }
  }
  return null;
}

/**
 * Execute a skill script and parse JSON output
 *
 * @param scriptPath - Full path to the script
 * @param args - Command line arguments
 * @param options - Execution options
 * @returns Parsed result with success status and data
 */
export async function runSkillScript<T>(
  scriptPath: string,
  args: string[],
  options: ICliRunnerOptions = {}
): Promise<ICliResult<T>> {
  const {
    endpoint,
    groupId,
    timeout = 30000,
    cwd = projectRoot,
    env = {},
  } = options;

  const cmdArgs = [...args];
  if (endpoint) cmdArgs.push('--endpoint', endpoint);
  if (groupId) cmdArgs.push('--group', groupId);
  cmdArgs.push('--cache'); // Always use cache for fallback behavior

  // Escape scriptPath for Windows compatibility
  const escapedPath = scriptPath.includes(' ') ? `"${scriptPath}"` : scriptPath;
  const cmd = `node ${escapedPath} ${cmdArgs.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout,
      cwd,
      env: {
        ...process.env,
        ...loadedEnv,
        ...env,
      },
    });

    // Parse JSON from stdout (may have multiple lines, take last valid JSON)
    const lines = stdout.trim().split('\n');
    let data: T | undefined;
    let parseError: Error | undefined;

    // Try parsing from last line first (most common case)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') || line.startsWith('[')) {
        try {
          data = JSON.parse(line) as T;
          break;
        } catch (e) {
          parseError = e as Error;
        }
      }
    }

    if (!data) {
      // Try parsing entire output as JSON
      try {
        data = JSON.parse(stdout.trim()) as T;
      } catch (e) {
        return {
          success: false,
          error: parseError?.message || 'Failed to parse JSON output',
          stdout,
          stderr,
        };
      }
    }

    const status = (data as Record<string, unknown>)?.status;
    return {
      success: status === 'ok',
      data,
      stdout,
      stderr,
    };
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return {
      success: false,
      error: err.message || 'Command execution failed',
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

/**
 * Check if a skill script exists
 *
 * @param skillName - Name of the skill
 * @returns True if script exists
 */
export function skillScriptExists(skillName: string): boolean {
  return findSkillScript(skillName) !== null;
}

/**
 * Get the project root directory
 */
export function getProjectRoot(): string {
  return projectRoot;
}
