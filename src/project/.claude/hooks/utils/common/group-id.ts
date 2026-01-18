/**
 * Group ID utilities for folder-based hierarchical memory.
 *
 * Generates group IDs based on folder paths for memory isolation.
 * Supports hierarchical queries (current folder + all parents up to $HOME).
 */
export {}; // mark as module to keep scoped declarations

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_GROUP_ID_LENGTH = 128;

// ============================================================================
// Group ID Functions
// ============================================================================

/**
 * Normalize a path to a valid group ID string.
 * /Users/tony.casey/Repos/api -> users-tony_casey-repos-api
 * C:\dev\lisa -> c-dev-lisa
 */
function normalizePathToGroupId(absolutePath: string): string {
  let normalized = absolutePath
    .toLowerCase()
    .replace(/^[a-z]:[\\\/]/i, '') // Remove Windows drive letter (C:\, D:\, etc.)
    .replace(/^\//, '') // Remove leading slash (Unix)
    .replace(/[\\\/]+/g, '-') // Replace slashes and backslashes with dashes
    .replace(/\./g, '_'); // Replace dots with underscores (Graphiti requires alphanumeric, dashes, underscores only)

  // Truncate if too long (keep the end which is most specific)
  if (normalized.length > MAX_GROUP_ID_LENGTH) {
    normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
  }

  return normalized;
}

/**
 * Get the current folder's group ID (uses folder basename).
 * E.g., "lisa" from "C:\dev\lisa" or "/home/user/projects/lisa"
 */
function getCurrentGroupId(cwd: string = process.cwd()): string {
  const basename = path.basename(cwd);
  return basename
    .toLowerCase()
    .replace(/\./g, '_') // Graphiti requires alphanumeric, dashes, underscores only
    .replace(/[^a-z0-9_-]/g, '-'); // Replace any other invalid chars
}

/**
 * Get hierarchical group IDs. Currently just returns the current folder's basename.
 * Hierarchical traversal was removed in favor of simple folder-based grouping.
 *
 * Example: For /Users/tony/Repos/api or C:\dev\api, returns ['api']
 */
function getHierarchicalGroupIds(cwd: string = process.cwd()): string[] {
  const groupId = getCurrentGroupId(cwd);
  return groupId ? [groupId] : [];
}

// ============================================================================
// Folder Metadata Detection
// ============================================================================

interface IFolderMetadata {
  path: string;
  groupId: string;
  type: 'project' | 'documents' | 'assets' | 'unknown';
  projectType?: string; // 'typescript', 'python', 'go', 'rust', etc.
  framework?: string; // 'react', 'nextjs', 'fastapi', 'express', etc.
  description?: string; // From package.json or auto-generated
}

/**
 * Detect folder metadata by checking for project markers and file types.
 */
function detectFolderMetadata(cwd: string = process.cwd()): IFolderMetadata {
  const groupId = getCurrentGroupId(cwd);
  const base: IFolderMetadata = { path: cwd, groupId, type: 'unknown' };

  // Check for Node.js/TypeScript project
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // Detect framework
      let framework: string | undefined;
      if (deps.next) framework = 'nextjs';
      else if (deps.react) framework = 'react';
      else if (deps.express) framework = 'express';
      else if (deps.fastify) framework = 'fastify';
      else if (deps.hono) framework = 'hono';
      else if (deps.vue) framework = 'vue';
      else if (deps.angular) framework = 'angular';
      else if (deps.svelte) framework = 'svelte';

      // Detect if TypeScript
      const isTypeScript = deps.typescript || fs.existsSync(path.join(cwd, 'tsconfig.json'));

      return {
        ...base,
        type: 'project',
        projectType: isTypeScript ? 'typescript' : 'javascript',
        framework,
        description: pkg.description,
      };
    } catch (_err) {
      // Invalid package.json, continue detection
    }
  }

  // Check for Python project
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py'))) {
    let framework: string | undefined;
    const reqPath = path.join(cwd, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        const reqs = fs.readFileSync(reqPath, 'utf8').toLowerCase();
        if (reqs.includes('fastapi')) framework = 'fastapi';
        else if (reqs.includes('django')) framework = 'django';
        else if (reqs.includes('flask')) framework = 'flask';
      } catch (_err) {
        // Ignore
      }
    }
    return { ...base, type: 'project', projectType: 'python', framework };
  }

  // Check for Rust project
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { ...base, type: 'project', projectType: 'rust' };
  }

  // Check for Go project
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return { ...base, type: 'project', projectType: 'go' };
  }

  // Check for Java/Kotlin project
  if (fs.existsSync(path.join(cwd, 'pom.xml')) || fs.existsSync(path.join(cwd, 'build.gradle'))) {
    return { ...base, type: 'project', projectType: 'java' };
  }

  // Check folder contents for type hints
  try {
    const files = fs.readdirSync(cwd);
    const hasDocuments = files.some((f: string) => /\.(md|txt|doc|docx|rst)$/i.test(f));
    const hasAssets = files.some((f: string) => /\.(png|jpg|jpeg|gif|svg|mp4|mp3|pdf|ai|psd)$/i.test(f));

    if (hasAssets && !hasDocuments) {
      return { ...base, type: 'assets' };
    }
    if (hasDocuments) {
      return { ...base, type: 'documents' };
    }
  } catch (_err) {
    // Can't read directory
  }

  return base;
}

/**
 * Format folder metadata for display.
 * Returns a string like "TypeScript/React project" or "Python/FastAPI project"
 */
function formatFolderMetadata(metadata: IFolderMetadata): string {
  if (metadata.type === 'unknown') {
    return 'folder';
  }

  if (metadata.type === 'documents') {
    return 'documents';
  }

  if (metadata.type === 'assets') {
    return 'assets';
  }

  // Project type
  const parts: string[] = [];

  if (metadata.projectType) {
    // Capitalize first letter
    parts.push(metadata.projectType.charAt(0).toUpperCase() + metadata.projectType.slice(1));
  }

  if (metadata.framework) {
    // Capitalize first letter
    parts.push(metadata.framework.charAt(0).toUpperCase() + metadata.framework.slice(1));
  }

  if (parts.length === 0) {
    return 'project';
  }

  return `${parts.join('/')} project`;
}

module.exports = {
  MAX_GROUP_ID_LENGTH,
  normalizePathToGroupId,
  getCurrentGroupId,
  getHierarchicalGroupIds,
  detectFolderMetadata,
  formatFolderMetadata,
};
