/**
 * Shared constants for CLI commands.
 */

import path from 'path';
import fs from 'fs-extra';

// Templates are copied into dist/project by postbuild; resolve relative to compiled file.
export const TEMPLATE_ROOT = path.join(__dirname, '..', '..', '..', 'project');

// Bundled OpenCode plugin is in dist/opencode
export const BUNDLED_OPENCODE_ROOT = path.join(__dirname, '..', '..', '..', 'opencode');

// Read version from package.json (works in both dev and dist)
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', 'package.json');
export const VERSION = fs.existsSync(PACKAGE_JSON_PATH)
  ? (fs.readJsonSync(PACKAGE_JSON_PATH) as { version: string }).version
  : '0.0.0';

export const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
export const ZEP_CLOUD_ENDPOINT = 'https://api.getzep.com/mcp/';

/**
 * Get project name from package.json or directory name.
 * Used for display purposes (e.g., init output). NOT used for group ID routing -
 * group IDs are derived from the full folder path via getCurrentGroupId().
 */
export function getProjectName(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = fs.readJsonSync(pkgPath);
      if (pkg.name) {
        // Remove scope prefix if present (e.g., @tonycasey/lisa -> lisa)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch {
    // Ignore errors reading package.json
  }
  // Fall back to directory name
  return path.basename(process.cwd());
}

export const DEFAULT_GROUP = getProjectName();

// Deployment mode types
export type DeploymentMode = 'local' | 'zep-cloud' | 'skip';

// CLI support types
export type CliSupport = 'claude-code' | 'opencode';

/**
 * Graphiti configuration interface.
 * Note: groupId is no longer configurable - it's derived from the project folder path.
 */
export interface IGraphitiConfig {
  mode: DeploymentMode;
  endpoint: string;
  // Zep Cloud specific
  zepApiKey?: string;
  zepProjectId?: string;
}
