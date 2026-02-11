/**
 * Shared CLI Runner for Skill Integration Tests
 *
 * Provides utilities for executing skill commands via the Lisa CLI and parsing JSON output.
 * Used for git-mem integration tests.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ICliRunnerOptions, ICliResult } from './types';

const execAsync = promisify(exec);

// Project root for finding CLI
const projectRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Check if the Lisa CLI is available.
 *
 * @param skillName - Name of the skill (e.g., 'memory', 'tasks')
 * @returns 'lisa' if CLI is available, null otherwise
 */
export function findSkillScript(skillName: string): string | null {
  // Skills are now accessed via the `lisa <skill>` CLI command
  // Check if 'lisa' command exists and the skill is supported
  const supportedSkills = ['memory', 'tasks'];
  if (!supportedSkills.includes(skillName)) {
    return null;
  }
  
  // Check if lisa CLI is available by looking for it in node_modules or globally
  try {
    // First check if we're in development (lisa is in node_modules/.bin)
    const localLisa = path.join(projectRoot, 'node_modules', '.bin', 'lisa');
    if (fs.existsSync(localLisa)) {
      return skillName; // Return skill name as indicator that CLI is available
    }
    
    // Check if dist/lib/cli.js exists (development mode)
    const distCli = path.join(projectRoot, 'dist', 'lib', 'cli.js');
    if (fs.existsSync(distCli)) {
      return skillName; // Return skill name as indicator that CLI is available
    }
    
    // Fall back to checking if 'lisa' is globally available
    // We can't easily check this synchronously, so just return the skill name
    // and let the actual execution fail if lisa isn't available
    return skillName;
  } catch {
    return null;
  }
}

/**
 * Execute a skill command via the Lisa CLI and parse JSON output
 *
 * @param skillName - Name of the skill (e.g., 'memory', 'tasks')
 * @param args - Command line arguments
 * @param options - Execution options
 * @returns Parsed result with success status and data
 */
export async function runSkillScript<T>(
  skillName: string,
  args: string[],
  options: ICliRunnerOptions = {}
): Promise<ICliResult<T>> {
  const {
    groupId,
    timeout = 30000,
    cwd = projectRoot,
    testRepoPath,
    env = {},
  } = options;

  const cmdArgs = [...args];
  if (groupId) cmdArgs.push('--group', groupId);

  // Use lisa CLI command (either local dist or global installation)
  const distCli = path.join(projectRoot, 'dist', 'lib', 'cli.js');
  const lisaCmd = fs.existsSync(distCli) ? `node ${distCli}` : 'lisa';
  const cmd = `${lisaCmd} ${skillName} ${cmdArgs.join(' ')}`;

  // Use testRepoPath as cwd if provided (for git-mem operations)
  const effectiveCwd = testRepoPath || cwd;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout,
      cwd: effectiveCwd,
      env: {
        ...process.env,
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
