import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import type { ILisaContext } from '../../domain/interfaces';

const ENV_FILE = '.lisa/.env';
const MAX_GROUP_ID_LENGTH = 128;

interface EnvConfig {
  PROJECT_NAME?: string;
  PROJECT_ALIASES?: string;
  [key: string]: string | undefined;
}

interface IFolderMetadata {
  path: string;
  groupId: string;
  type: 'project' | 'documents' | 'assets' | 'unknown';
  projectType?: string;
  framework?: string;
  description?: string;
}

/**
 * Detects project context from the current working directory.
 */
export class ContextDetector {
  /**
   * Detect full context for a project.
   */
  static detect(projectRoot: string = process.cwd()): ILisaContext {
    const groupId = ContextDetector.getCurrentGroupId(projectRoot);
    const hierarchicalGroupIds = ContextDetector.getHierarchicalGroupIds(projectRoot);
    const projectName = ContextDetector.detectRepo(projectRoot);
    const projectAliases = ContextDetector.getProjectAliases(projectRoot);
    const branch = ContextDetector.detectBranch(projectRoot);
    const userName = ContextDetector.getUserName();
    const folderMetadata = ContextDetector.detectFolderMetadata(projectRoot);
    const folderType = ContextDetector.formatFolderMetadata(folderMetadata);

    return {
      projectRoot,
      gitWorktree: undefined,
      groupId,
      hierarchicalGroupIds,
      projectName,
      projectAliases,
      branch,
      userName,
      folderType,
    };
  }

  // --- Group ID Functions ---

  /**
   * Normalize a path to a valid group ID string.
   */
  static normalizePathToGroupId(absolutePath: string): string {
    let normalized = absolutePath
      .toLowerCase()
      .replace(/^\//, '')
      .replace(/\\/g, '-')
      .replace(/\//g, '-')
      .replace(/\./g, '_')
      .replace(/:/g, '');

    if (normalized.length > MAX_GROUP_ID_LENGTH) {
      normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
    }

    return normalized;
  }

  /**
   * Get the current folder's group ID.
   */
  static getCurrentGroupId(cwd: string = process.cwd()): string {
    return ContextDetector.normalizePathToGroupId(cwd);
  }

  /**
   * Get hierarchical group IDs from current folder up to root.
   * Always includes at least the current folder's group ID.
   */
  static getHierarchicalGroupIds(cwd: string = process.cwd()): string[] {
    const homeDir = os.homedir();
    const groups: string[] = [];

    let currentPath = path.resolve(cwd);
    const maxIterations = 20; // Safety limit
    let iterations = 0;

    while (iterations < maxIterations) {
      groups.push(ContextDetector.normalizePathToGroupId(currentPath));

      // Stop at home directory if we're under it
      if (currentPath === homeDir) {
        break;
      }

      const parentPath = path.dirname(currentPath);
      
      // Stop at root (parent equals current)
      if (parentPath === currentPath) {
        break;
      }
      
      // Stop at drive root on Windows (e.g., C:\)
      if (parentPath.match(/^[A-Za-z]:\\?$/)) {
        groups.push(ContextDetector.normalizePathToGroupId(parentPath));
        break;
      }
      
      currentPath = parentPath;
      iterations++;
    }

    return groups;
  }

  // --- Project Detection ---

  /**
   * Parse a .env file into key-value pairs.
   */
  private static parseEnvFile(content: string): EnvConfig {
    const env: EnvConfig = {};
    content.split(/\r?\n/).forEach((line) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return env;
  }

  /**
   * Read the .lisa/.env file.
   */
  private static readEnvConfig(projectRoot: string): EnvConfig {
    const envPath = path.join(projectRoot, ENV_FILE);
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        return ContextDetector.parseEnvFile(content);
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return {};
  }

  /**
   * Detect project name from package.json.
   */
  private static detectFromPackageJson(projectRoot: string): string | null {
    try {
      const pkgPath = path.join(projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name && typeof pkg.name === 'string') {
          return pkg.name.replace(/^@[^/]+\//, '');
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Detect project name from pyproject.toml.
   */
  private static detectFromPyproject(projectRoot: string): string | null {
    try {
      const pyPath = path.join(projectRoot, 'pyproject.toml');
      if (fs.existsSync(pyPath)) {
        const content = fs.readFileSync(pyPath, 'utf8');
        const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Detect project name from Cargo.toml.
   */
  private static detectFromCargoToml(projectRoot: string): string | null {
    try {
      const cargoPath = path.join(projectRoot, 'Cargo.toml');
      if (fs.existsSync(cargoPath)) {
        const content = fs.readFileSync(cargoPath, 'utf8');
        const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
        if (match) {
          return match[1];
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Detect project name from go.mod.
   */
  private static detectFromGoMod(projectRoot: string): string | null {
    try {
      const goModPath = path.join(projectRoot, 'go.mod');
      if (fs.existsSync(goModPath)) {
        const content = fs.readFileSync(goModPath, 'utf8');
        const match = content.match(/^\s*module\s+(\S+)/m);
        if (match) {
          const parts = match[1].split('/');
          return parts[parts.length - 1];
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Detect project name using the fallback chain.
   */
  private static detectProjectName(projectRoot: string): { name: string; source: string } {
    const pkgName = ContextDetector.detectFromPackageJson(projectRoot);
    if (pkgName) return { name: pkgName, source: 'package.json' };

    const pyName = ContextDetector.detectFromPyproject(projectRoot);
    if (pyName) return { name: pyName, source: 'pyproject.toml' };

    const cargoName = ContextDetector.detectFromCargoToml(projectRoot);
    if (cargoName) return { name: cargoName, source: 'Cargo.toml' };

    const goName = ContextDetector.detectFromGoMod(projectRoot);
    if (goName) return { name: goName, source: 'go.mod' };

    return { name: path.basename(projectRoot), source: 'folder' };
  }

  /**
   * Get the project name.
   */
  static detectRepo(projectRoot: string): string {
    const env = ContextDetector.readEnvConfig(projectRoot);
    if (env.PROJECT_NAME) {
      return env.PROJECT_NAME;
    }

    const detected = ContextDetector.detectProjectName(projectRoot);
    return detected.name;
  }

  /**
   * Get project aliases for querying.
   */
  static getProjectAliases(projectRoot: string): string[] {
    const env = ContextDetector.readEnvConfig(projectRoot);
    const projectName = env.PROJECT_NAME || ContextDetector.detectRepo(projectRoot);
    const folderName = path.basename(projectRoot);

    const aliases = new Set<string>();
    aliases.add(projectName);

    if (env.PROJECT_ALIASES) {
      env.PROJECT_ALIASES.split(',').forEach((alias) => {
        const trimmed = alias.trim();
        if (trimmed) aliases.add(trimmed);
      });
    }

    if (folderName !== projectName) {
      aliases.add(folderName);
    }

    return Array.from(aliases);
  }

  /**
   * Detect git branch.
   */
  static detectBranch(projectRoot: string): string | null {
    try {
      const out = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.toString().trim();
    } catch {
      return null;
    }
  }

  /**
   * Get current user name.
   */
  static getUserName(): string {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }

  /**
   * Generate repo tags for queries.
   */
  static repoTags(options: { repo?: string; branch?: string | null } = {}): string[] {
    const tags: string[] = [];
    if (options.repo) tags.push(`repo:${options.repo}`);
    if (options.branch) tags.push(`branch:${options.branch}`);
    return tags;
  }

  // --- Folder Metadata ---

  /**
   * Detect folder metadata.
   */
  static detectFolderMetadata(projectRoot: string): IFolderMetadata {
    const groupId = ContextDetector.getCurrentGroupId(projectRoot);
    const base: IFolderMetadata = { path: projectRoot, groupId, type: 'unknown' };

    // Check for Node.js/TypeScript project
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        let framework: string | undefined;
        if (deps.next) framework = 'nextjs';
        else if (deps.react) framework = 'react';
        else if (deps.express) framework = 'express';
        else if (deps.fastify) framework = 'fastify';
        else if (deps.hono) framework = 'hono';
        else if (deps.vue) framework = 'vue';
        else if (deps.angular) framework = 'angular';
        else if (deps.svelte) framework = 'svelte';

        const isTypeScript = deps.typescript || fs.existsSync(path.join(projectRoot, 'tsconfig.json'));

        return {
          ...base,
          type: 'project',
          projectType: isTypeScript ? 'typescript' : 'javascript',
          framework,
          description: pkg.description,
        };
      } catch {
        // Invalid package.json
      }
    }

    // Check for Python project
    if (fs.existsSync(path.join(projectRoot, 'pyproject.toml')) || fs.existsSync(path.join(projectRoot, 'setup.py'))) {
      let framework: string | undefined;
      const reqPath = path.join(projectRoot, 'requirements.txt');
      if (fs.existsSync(reqPath)) {
        try {
          const reqs = fs.readFileSync(reqPath, 'utf8').toLowerCase();
          if (reqs.includes('fastapi')) framework = 'fastapi';
          else if (reqs.includes('django')) framework = 'django';
          else if (reqs.includes('flask')) framework = 'flask';
        } catch {
          // Ignore
        }
      }
      return { ...base, type: 'project', projectType: 'python', framework };
    }

    // Check for Rust project
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      return { ...base, type: 'project', projectType: 'rust' };
    }

    // Check for Go project
    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
      return { ...base, type: 'project', projectType: 'go' };
    }

    // Check for Java/Kotlin project
    if (fs.existsSync(path.join(projectRoot, 'pom.xml')) || fs.existsSync(path.join(projectRoot, 'build.gradle'))) {
      return { ...base, type: 'project', projectType: 'java' };
    }

    return base;
  }

  /**
   * Format folder metadata for display.
   */
  static formatFolderMetadata(metadata: IFolderMetadata): string {
    if (metadata.type === 'unknown') return 'folder';
    if (metadata.type === 'documents') return 'documents';
    if (metadata.type === 'assets') return 'assets';

    const parts: string[] = [];

    if (metadata.projectType) {
      parts.push(metadata.projectType.charAt(0).toUpperCase() + metadata.projectType.slice(1));
    }

    if (metadata.framework) {
      parts.push(metadata.framework.charAt(0).toUpperCase() + metadata.framework.slice(1));
    }

    if (parts.length === 0) return 'project';

    return `${parts.join('/')} project`;
  }
}
