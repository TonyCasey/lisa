/**
 * discovery.ts - Recursively discover projects in a directory tree
 *
 * Walks directories looking for project markers (package.json, pyproject.toml, etc.)
 * Stops descent when a project is found (doesn't scan inside projects)
 */

import fs from 'fs-extra';
import path from 'path';

// Project marker files that indicate a project root
const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
];

// Directories to skip during traversal
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.next',
  '.agents',
  '.claude',
  '.dev',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
]);

export interface IDiscoveredProject {
  path: string;
  name: string;
  type: 'npm' | 'python' | 'rust' | 'go' | 'java' | 'ruby' | 'php' | 'unknown';
  marker: string;
}

/**
 * Get project type from the marker file
 */
function getProjectType(marker: string): IDiscoveredProject['type'] {
  switch (marker) {
    case 'package.json':
      return 'npm';
    case 'pyproject.toml':
    case 'setup.py':
      return 'python';
    case 'Cargo.toml':
      return 'rust';
    case 'go.mod':
      return 'go';
    case 'pom.xml':
    case 'build.gradle':
      return 'java';
    case 'Gemfile':
      return 'ruby';
    case 'composer.json':
      return 'php';
    default:
      return 'unknown';
  }
}

/**
 * Get project name from manifest file
 */
function getProjectName(projectPath: string, marker: string): string {
  try {
    if (marker === 'package.json') {
      const pkg = fs.readJsonSync(path.join(projectPath, marker));
      if (pkg.name) {
        // Remove scope prefix (e.g., @org/pkg -> pkg)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }

    if (marker === 'pyproject.toml') {
      const content = fs.readFileSync(path.join(projectPath, marker), 'utf8');
      const match = content.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }

    if (marker === 'Cargo.toml') {
      const content = fs.readFileSync(path.join(projectPath, marker), 'utf8');
      const match = content.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }

    if (marker === 'go.mod') {
      const content = fs.readFileSync(path.join(projectPath, marker), 'utf8');
      const match = content.match(/module\s+([^\s]+)/);
      if (match) {
        // Return last part of module path
        const parts = match[1].split('/');
        return parts[parts.length - 1];
      }
    }
  } catch {
    // Fall back to directory name
  }

  return path.basename(projectPath);
}

/**
 * Check if a directory contains a project marker
 */
function findProjectMarker(dirPath: string): string | null {
  for (const marker of PROJECT_MARKERS) {
    if (fs.existsSync(path.join(dirPath, marker))) {
      return marker;
    }
  }
  return null;
}

/**
 * Recursively discover projects in a directory
 *
 * @param rootPath - The root directory to scan
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Array of discovered projects
 */
export async function discoverProjects(
  rootPath: string,
  maxDepth: number = 10
): Promise<IDiscoveredProject[]> {
  const projects: IDiscoveredProject[] = [];
  const absoluteRoot = path.resolve(rootPath);

  async function traverse(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    // Check if this directory is a project
    const marker = findProjectMarker(dirPath);
    if (marker) {
      // Don't scan the root itself if it's a project
      if (dirPath !== absoluteRoot) {
        projects.push({
          path: dirPath,
          name: getProjectName(dirPath, marker),
          type: getProjectType(marker),
          marker,
        });
      }
      // Stop descent - don't scan inside projects
      return;
    }

    // Not a project, scan subdirectories
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue; // Skip hidden directories

        const subPath = path.join(dirPath, entry.name);
        await traverse(subPath, depth + 1);
      }
    } catch {
      // Ignore permission errors or other issues
    }
  }

  await traverse(absoluteRoot, 0);

  // Sort by path for consistent output
  projects.sort((a, b) => a.path.localeCompare(b.path));

  return projects;
}

/**
 * Check if a path is a project root
 */
export function isProjectRoot(dirPath: string): boolean {
  return findProjectMarker(dirPath) !== null;
}
