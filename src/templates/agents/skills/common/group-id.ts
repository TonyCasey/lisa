/**
 * Group ID Utilities
 *
 * Shared functions for normalizing paths to Graphiti group IDs.
 * Used by memory, tasks, prompt, and other skills.
 */

import * as path from 'path';
import * as os from 'os';

export const MAX_GROUP_ID_LENGTH = 128;

/**
 * Normalize a path to a valid group ID string.
 * Works cross-platform (Windows and Unix).
 *
 * @example
 * normalizePathToGroupId('/Users/tony.casey/Repos/api') // 'users-tony_casey-repos-api'
 * normalizePathToGroupId('C:\\dev\\lisa') // 'c-dev-lisa'
 */
export function normalizePathToGroupId(absolutePath: string): string {
  let normalized = absolutePath
    .toLowerCase()
    .replace(/^[a-z]:/i, (match) => match.charAt(0)) // C: -> c
    .replace(/^\//, '')       // Remove leading slash (Unix)
    .replace(/\\/g, '-')      // Backslash to dash (Windows)
    .replace(/\//g, '-')      // Forward slash to dash (Unix)
    .replace(/\./g, '_')      // Dots to underscores
    .replace(/^-+/, '')       // Remove leading dashes
    .replace(/-+/g, '-');     // Collapse multiple dashes

  if (normalized.length > MAX_GROUP_ID_LENGTH) {
    normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
  }
  return normalized;
}

/**
 * Get the current folder's group ID.
 */
export function getCurrentGroupId(cwd: string = process.cwd()): string {
  return normalizePathToGroupId(cwd);
}

/**
 * Check if we're on Windows
 */
export function isWindows(): boolean {
  return os.platform() === 'win32';
}

/**
 * Get the root boundary for hierarchical traversal.
 * - Windows: drive root (e.g., C:\) or home directory, whichever is deeper
 * - Unix: home directory or /
 */
export function getRootBoundary(cwd: string = process.cwd()): string {
  const homeDir = os.homedir();
  if (isWindows()) {
    // On Windows, check if cwd is under home directory
    const cwdLower = cwd.toLowerCase();
    const homeLower = homeDir.toLowerCase();
    if (cwdLower.startsWith(homeLower)) {
      return homeDir; // Under home, use home as boundary
    }
    // Not under home (e.g., C:\dev\), use drive root as boundary
    const driveRoot = path.parse(cwd).root; // e.g., "C:\"
    return driveRoot;
  }
  // Unix: use home directory if under it, otherwise use /
  if (cwd.startsWith(homeDir)) {
    return homeDir;
  }
  return '/';
}

/**
 * Get hierarchical group IDs from current folder up to root boundary.
 * Returns array ordered from most specific (current) to least specific (root).
 * Works cross-platform (Windows and Unix).
 */
export function getHierarchicalGroupIds(cwd: string = process.cwd()): string[] {
  const rootBoundary = getRootBoundary(cwd);
  const groups: string[] = [];
  let currentPath = path.resolve(cwd);
  const maxDepth = 10; // Safety limit
  let depth = 0;

  while (depth < maxDepth) {
    groups.push(normalizePathToGroupId(currentPath));
    // Stop if we've reached the root boundary
    if (currentPath.toLowerCase() === rootBoundary.toLowerCase()) {
      break;
    }
    const parentPath = path.dirname(currentPath);
    // Stop if we can't go up anymore (reached filesystem root)
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
    depth++;
  }
  return groups;
}

/**
 * Entity type to tag mapping for memory classification.
 */
export const TYPE_MAP: Record<string, string> = {
  // Code & Architecture
  'decision': 'code:decision',
  'pattern': 'code:pattern',
  'dependency': 'code:dependency',
  'tech-debt': 'code:tech-debt',
  // Context & History
  'bug': 'context:bug',
  'rationale': 'context:rationale',
  'failed': 'context:failed',
  'quirk': 'context:quirk',
  // External
  'feedback': 'external:feedback',
  'incident': 'external:incident',
  'contract': 'external:contract',
  // People & Process
  'contributor': 'people:contributor',
  'review': 'people:review',
  'blocker': 'people:blocker',
  'estimate': 'people:estimate',
  // Project
  'scope-in': 'project:scope-in',
  'scope-out': 'project:scope-out',
  'milestone': 'project:milestone',
  'init-review': 'type:init-review',
};

/**
 * Auto-detect prefixes in text for automatic tagging.
 */
export const PREFIX_MAP: Record<string, string> = {
  'DECISION:': 'code:decision',
  'PATTERN:': 'code:pattern',
  'TECH-DEBT:': 'code:tech-debt',
  'BUG:': 'context:bug',
  'RATIONALE:': 'context:rationale',
  'FAILED:': 'context:failed',
  'INCIDENT:': 'external:incident',
  'BLOCKER:': 'people:blocker',
  'SCOPE-IN:': 'project:scope-in',
  'SCOPE-OUT:': 'project:scope-out',
  'INIT-REVIEW:': 'type:init-review',
};

/**
 * Detect tag from text prefix.
 */
export function detectPrefixTag(text: string): string | null {
  for (const [prefix, tag] of Object.entries(PREFIX_MAP)) {
    if (text.toUpperCase().startsWith(prefix)) {
      return tag;
    }
  }
  return null;
}
