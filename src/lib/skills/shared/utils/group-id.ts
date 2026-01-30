/**
 * Shared group ID utilities for folder-based memory isolation.
 * Used by memory, tasks, and other skills.
 * 
 * The group ID is derived from the project root (where .lisa directory exists).
 * This ensures consistent group IDs regardless of where in the project you run commands.
 */
import path from 'path';
import fs from 'fs';

/**
 * Find the .lisa directory by traversing up from the given directory.
 * @param startDir - Directory to start searching from
 * @returns Path to .lisa directory or null if not found
 */
function findLisaDir(startDir: string): string | null {
  let dir = startDir;
  
  // Traverse up to 10 levels looking for .lisa
  for (let i = 0; i < 10; i++) {
    const lisaDir = path.join(dir, '.lisa');
    if (fs.existsSync(lisaDir) && fs.statSync(lisaDir).isDirectory()) {
      return lisaDir;
    }
    
    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached root
    dir = parent;
  }
  
  return null;
}

/**
 * Get the project root directory (parent of .lisa directory).
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Project root path or cwd if .lisa not found
 */
function getProjectRoot(cwd: string = process.cwd()): string {
  const lisaDir = findLisaDir(cwd);
  if (lisaDir) {
    return path.dirname(lisaDir);
  }
  // Fallback: use current directory
  return cwd;
}

/**
 * Get the canonical group ID based on the project root path.
 * The group ID is the full normalized path where .lisa was initialized.
 * 
 * Cross-platform: Works on Windows (\), Mac/Linux (/)
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Normalized group ID
 */
export function getCurrentGroupId(cwd: string = process.cwd()): string {
  const projectRoot = getProjectRoot(cwd);
  return normalizeGroupId(projectRoot);
}

/**
 * Normalize a path to a valid Graphiti group ID.
 * Graphiti requires alphanumeric characters, dashes, and underscores only.
 * 
 * Cross-platform path handling:
 * - Windows: C:\dev\lisa -> c-dev-lisa
 * - Unix: /home/user/lisa -> home-user-lisa
 * 
 * @param input - Path string to normalize
 * @returns Normalized group ID
 */
export function normalizeGroupId(input: string): string {
  return input
    .toLowerCase()
    // Remove drive letter colon (Windows C: -> c, must run before path separator replacement)
    .replace(/^([a-z]):/, '$1')
    // Normalize path separators (Windows \ and Unix /) to dash
    .replace(/[\\/]+/g, '-')
    // Replace dots with underscores
    .replace(/\./g, '_')
    // Replace any remaining invalid chars with dashes
    .replace(/[^a-z0-9_-]/g, '-')
    // Remove leading/trailing dashes
    .replace(/^-+|-+$/g, '')
    // Collapse multiple consecutive dashes
    .replace(/-+/g, '-');
}

/**
 * Get group IDs for querying.
 * Returns array with current folder's group ID.
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of group IDs to query
 */
export function getGroupIds(cwd: string = process.cwd()): string[] {
  return getGroupIdsWithLegacy(cwd);
}

/**
 * Generate a hierarchical list of group IDs from a path.
 * Uses the full normalized path and its parent paths.
 * E.g., "/home/user/projects/lisa" returns ["home-user-projects-lisa", "home-user-projects", "home-user"]
 * 
 * This allows querying memories from parent directories as well.
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @param maxDepth - Maximum number of parent levels to include
 * @returns Array of group IDs from current to parents
 */
export function getHierarchicalGroupIds(
  cwd: string = process.cwd(),
  maxDepth: number = 3
): string[] {
  const groupIds: string[] = [];
  let currentPath = cwd;

  for (let i = 0; i < maxDepth; i++) {
    if (!currentPath || currentPath === path.dirname(currentPath)) break; // Reached root

    const groupId = normalizeGroupId(currentPath);
    if (groupId && !groupIds.includes(groupId)) {
      groupIds.push(groupId);
    }

    currentPath = path.dirname(currentPath);
  }

  return groupIds;
}

/**
 * Get group IDs for querying with backward compatibility.
 * Includes the canonical group ID plus the legacy basename-based ID for migration.
 * 
 * This ensures existing data stored under the old basename format (e.g., "lisa")
 * is still accessible while new data uses the full path format (e.g., "c-dev-lisa").
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of group IDs to query (canonical + legacy)
 */
export function getGroupIdsWithLegacy(cwd: string = process.cwd()): string[] {
  const groupIds = new Set<string>();
  
  // Add canonical full-path group ID
  const canonicalId = getCurrentGroupId(cwd);
  if (canonicalId) {
    groupIds.add(canonicalId);
  }
  
  // Add legacy basename-based group ID for backward compatibility
  // This allows reading old data stored under the previous naming scheme
  const projectRoot = getProjectRoot(cwd);
  const legacyId = normalizeGroupId(path.basename(projectRoot));
  if (legacyId && legacyId !== canonicalId) {
    groupIds.add(legacyId);
  }
  
  return Array.from(groupIds);
}

/**
 * Create a Zep-compatible user ID from a group ID.
 * E.g., "lisa" -> "lisa-user"
 */
export function createZepUserId(groupId: string): string {
  return `lisa-${groupId}`;
}

/**
 * Create a Zep-compatible thread ID for a specific purpose.
 * E.g., ("lisa", "memory") -> "lisa-memory-lisa"
 */
export function createZepThreadId(groupId: string, purpose: string): string {
  return `lisa-${purpose}-${groupId}`;
}
