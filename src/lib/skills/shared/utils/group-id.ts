/**
 * Shared group ID utilities for folder-based memory isolation.
 * Used by memory, tasks, and other skills.
 */
import path from 'path';

/**
 * Get the current folder's group ID (uses folder basename).
 * E.g., "lisa" from "C:\dev\lisa" or "/home/user/projects/lisa"
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Normalized group ID
 */
export function getCurrentGroupId(cwd: string = process.cwd()): string {
  const basename = path.basename(cwd);
  return normalizeGroupId(basename);
}

/**
 * Normalize a string to a valid Graphiti group ID.
 * Graphiti requires alphanumeric characters, dashes, and underscores only.
 * 
 * @param input - String to normalize
 * @returns Normalized group ID
 */
export function normalizeGroupId(input: string): string {
  return input
    .toLowerCase()
    .replace(/\./g, '_')           // Replace dots with underscores
    .replace(/[^a-z0-9_-]/g, '-'); // Replace other invalid chars with dashes
}

/**
 * Get group IDs for querying.
 * Returns array with current folder's group ID.
 * 
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of group IDs to query
 */
export function getGroupIds(cwd: string = process.cwd()): string[] {
  const groupId = getCurrentGroupId(cwd);
  return groupId ? [groupId] : [];
}

/**
 * Generate a hierarchical list of group IDs from a path.
 * E.g., "/home/user/projects/lisa/src" returns ["lisa", "projects", "user"]
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
    const basename = path.basename(currentPath);
    if (!basename || basename === currentPath) break; // Reached root

    const groupId = normalizeGroupId(basename);
    if (groupId && !groupIds.includes(groupId)) {
      groupIds.push(groupId);
    }

    currentPath = path.dirname(currentPath);
  }

  return groupIds;
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
