/**
 * Test Repository Utilities for git-mem Integration Tests
 *
 * Provides utilities for creating isolated test git repositories
 * that can be used with git-mem without affecting the main repository.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Create an isolated test git repository in a temp directory.
 * Initializes git and creates an initial commit so git-mem can attach notes.
 *
 * @param prefix - Prefix for the temp directory name (e.g., 'lisa-gitmem-memory')
 * @returns Path to the created test repository
 */
export async function createTestGitRepo(prefix: string): Promise<string> {
  // Create temp directory
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));

  // Initialize git repository
  await execAsync('git init', { cwd: tempDir });

  // Configure git user (required for commits)
  await execAsync('git config user.email "test@lisa.dev"', { cwd: tempDir });
  await execAsync('git config user.name "Lisa Test"', { cwd: tempDir });

  // Create an initial commit (required for git notes to work)
  const readmePath = path.join(tempDir, 'README.md');
  await fs.writeFile(readmePath, '# Test Repository\n\nCreated for git-mem integration tests.\n');
  await execAsync('git add README.md', { cwd: tempDir });
  await execAsync('git commit -m "Initial commit for integration tests"', { cwd: tempDir });

  return tempDir;
}

/**
 * Clean up a test git repository.
 *
 * @param repoPath - Path to the test repository to remove
 */
export async function cleanupTestGitRepo(repoPath: string): Promise<void> {
  // Safety check: only delete temp directories
  if (!repoPath.startsWith(os.tmpdir())) {
    throw new Error(`Refusing to delete non-temp directory: ${repoPath}`);
  }

  await fs.rm(repoPath, { recursive: true, force: true });
}

/**
 * Verify git-mem notes are stored correctly in a test repository.
 *
 * @param repoPath - Path to the test repository
 * @returns Object with note count and ref information
 */
export async function verifyGitNotes(
  repoPath: string
): Promise<{ noteCount: number; refs: string[] }> {
  try {
    // List git notes on the git-mem ref
    const { stdout } = await execAsync('git notes --ref=refs/notes/mem list', {
      cwd: repoPath,
    });

    const lines = stdout.trim().split('\n').filter((line) => line.length > 0);

    return {
      noteCount: lines.length,
      refs: lines,
    };
  } catch {
    // No notes exist yet
    return {
      noteCount: 0,
      refs: [],
    };
  }
}

/**
 * Clear all git-mem notes in a test repository.
 * Useful for resetting state between tests within the same suite.
 *
 * @param repoPath - Path to the test repository
 */
export async function clearGitMemNotes(repoPath: string): Promise<void> {
  try {
    // Get all notes
    const { stdout } = await execAsync('git notes --ref=refs/notes/mem list', {
      cwd: repoPath,
    });

    const lines = stdout.trim().split('\n').filter((line) => line.length > 0);

    // Remove each note
    for (const line of lines) {
      // Format is: <note-sha> <object-sha>
      const objectSha = line.split(/\s+/)[1];
      if (objectSha) {
        await execAsync(`git notes --ref=refs/notes/mem remove ${objectSha}`, {
          cwd: repoPath,
        });
      }
    }
  } catch {
    // No notes to clear, or already empty
  }
}

/**
 * Check if git-mem CLI is available.
 *
 * @returns true if git-mem is installed and accessible
 */
export async function isGitMemAvailable(): Promise<boolean> {
  try {
    await execAsync('git mem --version');
    return true;
  } catch {
    return false;
  }
}
