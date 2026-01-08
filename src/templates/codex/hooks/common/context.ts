/**
 * Context detection utilities for Codex hooks
 * Detects repository name, git branch, and generates tags
 *
 * Project name detection priority:
 * 1. .agents/.env PROJECT_NAME (explicit config)
 * 2. package.json name field
 * 3. pyproject.toml name field
 * 4. Cargo.toml name field
 * 5. go.mod module name
 * 6. Folder name (fallback)
 *
 * Aliases support:
 * - PROJECT_ALIASES in .agents/.env (comma-separated)
 * - Automatically includes folder name if different from PROJECT_NAME
 */
export {}; // keep scope local

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ENV_FILE = '.agents/.env';

interface EnvConfig {
  PROJECT_NAME?: string;
  PROJECT_ALIASES?: string;
  [key: string]: string | undefined;
}

/**
 * Parse a .env file into key-value pairs
 */
function parseEnvFile(content: string): EnvConfig {
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
 * Read the .agents/.env file
 */
function readEnvConfig(): EnvConfig {
  const envPath = path.join(process.cwd(), ENV_FILE);
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      return parseEnvFile(content);
    }
  } catch (_err) {
    // File doesn't exist or is invalid
  }
  return {};
}

/**
 * Write or update PROJECT_NAME in .agents/.env
 * Preserves existing entries
 */
function writeProjectName(projectName: string, detectedFrom: string): boolean {
  const envPath = path.join(process.cwd(), ENV_FILE);
  const agentsDir = path.join(process.cwd(), '.agents');

  try {
    // Ensure .agents directory exists
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    // Read existing content
    let lines: string[] = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    }

    // Check if PROJECT_NAME already exists
    const hasProjectName = lines.some(line =>
      line.trim().startsWith('PROJECT_NAME=')
    );

    if (!hasProjectName) {
      // Add PROJECT_NAME with a comment about detection source
      const newLines = [
        `# Project name detected from ${detectedFrom}`,
        `PROJECT_NAME=${projectName}`,
        '',
      ];

      // Prepend to existing content
      const content = [...newLines, ...lines].join('\n');
      fs.writeFileSync(envPath, content);
      return true;
    }
  } catch (_err) {
    // Failed to write - continue without persisting
  }
  return false;
}

/**
 * Detect project name from package.json
 */
function detectFromPackageJson(): string | null {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name && typeof pkg.name === 'string') {
        // Strip org scope if present (e.g., @org/package -> package)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch (_err) {
    // Ignore parse errors
  }
  return null;
}

/**
 * Detect project name from pyproject.toml (Python)
 */
function detectFromPyproject(): string | null {
  try {
    const pyPath = path.join(process.cwd(), 'pyproject.toml');
    if (fs.existsSync(pyPath)) {
      const content = fs.readFileSync(pyPath, 'utf8');
      // Simple regex to find name in [project] or [tool.poetry] section
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match) {
        return match[1];
      }
    }
  } catch (_err) {
    // Ignore errors
  }
  return null;
}

/**
 * Detect project name from Cargo.toml (Rust)
 */
function detectFromCargoToml(): string | null {
  try {
    const cargoPath = path.join(process.cwd(), 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const content = fs.readFileSync(cargoPath, 'utf8');
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match) {
        return match[1];
      }
    }
  } catch (_err) {
    // Ignore errors
  }
  return null;
}

/**
 * Detect project name from go.mod (Go)
 */
function detectFromGoMod(): string | null {
  try {
    const goModPath = path.join(process.cwd(), 'go.mod');
    if (fs.existsSync(goModPath)) {
      const content = fs.readFileSync(goModPath, 'utf8');
      // Module line like: module github.com/user/project
      const match = content.match(/^\s*module\s+(\S+)/m);
      if (match) {
        // Return just the last part (project name)
        const parts = match[1].split('/');
        return parts[parts.length - 1];
      }
    }
  } catch (_err) {
    // Ignore errors
  }
  return null;
}

/**
 * Detect project name using the fallback chain
 * Returns { name, source } where source indicates where it was detected from
 */
function detectProjectName(): { name: string; source: string } {
  // 1. Try package.json
  const pkgName = detectFromPackageJson();
  if (pkgName) {
    return { name: pkgName, source: 'package.json' };
  }

  // 2. Try pyproject.toml
  const pyName = detectFromPyproject();
  if (pyName) {
    return { name: pyName, source: 'pyproject.toml' };
  }

  // 3. Try Cargo.toml
  const cargoName = detectFromCargoToml();
  if (cargoName) {
    return { name: cargoName, source: 'Cargo.toml' };
  }

  // 4. Try go.mod
  const goName = detectFromGoMod();
  if (goName) {
    return { name: goName, source: 'go.mod' };
  }

  // 5. Fallback to folder name
  return { name: path.basename(process.cwd()), source: 'folder' };
}

/**
 * Get the project name, initializing .agents/.env if needed
 */
function detectRepo(): string {
  // 1. Check for PROJECT_NAME in .agents/.env
  const env = readEnvConfig();
  if (env.PROJECT_NAME) {
    return env.PROJECT_NAME;
  }

  // 2. Detect from config files and auto-initialize
  const detected = detectProjectName();
  writeProjectName(detected.name, detected.source);
  return detected.name;
}

/**
 * Get project aliases for querying (includes current name and all aliases)
 */
function getProjectAliases(): string[] {
  const env = readEnvConfig();
  const projectName = env.PROJECT_NAME || detectRepo();
  const folderName = path.basename(process.cwd());

  const aliases = new Set<string>();
  aliases.add(projectName);

  // Add explicit aliases from PROJECT_ALIASES
  if (env.PROJECT_ALIASES) {
    env.PROJECT_ALIASES.split(',').forEach((alias: string) => {
      const trimmed = alias.trim();
      if (trimmed) aliases.add(trimmed);
    });
  }

  // Auto-include folder name if different from project name
  if (folderName !== projectName) {
    aliases.add(folderName);
  }

  return Array.from(aliases);
}

/**
 * Get the env file path
 */
function getEnvPath(): string {
  return path.join(process.cwd(), ENV_FILE);
}

function detectBranch(): string | null {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim();
  } catch (_err) {
    return null;
  }
}

function repoTags({ repo, branch }: { repo?: string | null; branch?: string | null } = {}) {
  const tags: string[] = [];
  if (repo) tags.push(`repo:${repo}`);
  if (branch) tags.push(`branch:${branch}`);
  return tags;
}

/**
 * Generate repo tags for all aliases (for querying)
 */
function repoTagsWithAliases({ branch }: { branch?: string | null } = {}): string[][] {
  const aliases = getProjectAliases();
  return aliases.map(alias => repoTags({ repo: alias, branch }));
}

module.exports = {
  detectRepo,
  detectBranch,
  repoTags,
  repoTagsWithAliases,
  getProjectAliases,
  getEnvPath,
  readEnvConfig,
  ENV_FILE,
};
