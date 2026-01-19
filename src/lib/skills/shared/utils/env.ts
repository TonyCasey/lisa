/**
 * Environment configuration utilities.
 * Loads configuration from .lisa/.env and process.env.
 */
import fs from 'fs';
import path from 'path';

/**
 * Environment configuration for Lisa skills.
 */
export interface IEnvConfig {
  // Storage mode
  STORAGE_MODE: 'local' | 'neo4j' | 'zep-cloud';

  // Graphiti MCP settings
  GRAPHITI_ENDPOINT: string;
  GRAPHITI_GROUP_ID?: string;

  // Neo4j settings
  NEO4J_URI: string;
  NEO4J_USER: string;
  NEO4J_PASSWORD: string;
  NEO4J_DATABASE: string;

  // Zep Cloud settings
  ZEP_API_KEY?: string;
  ZEP_BASE_URL?: string;

  // Logging settings
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  LOG_DIR?: string;
  LOG_CONSOLE: boolean;

  // Raw env for additional keys
  raw: Record<string, string>;
}

/**
 * Get the .lisa directory path by traversing up from current file.
 */
function getLisaDir(): string {
  let dir = __dirname;

  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    const baseName = path.basename(dir);

    if (baseName === '.lisa') {
      return dir;
    }

    if (path.basename(parent) === '.lisa') {
      return parent;
    }

    dir = parent;
  }

  // Fallback: assume .lisa is at project root
  return path.join(process.cwd(), '.lisa');
}

/**
 * Read .env file and return key-value pairs.
 */
function readEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line: string) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      env[key] = val;
    });
  } catch {
    // .env file is optional
  }
  return env;
}

/**
 * Load environment configuration.
 * Merges .lisa/.env with process.env (process.env takes precedence).
 */
export function loadEnv(): IEnvConfig {
  const lisaDir = getLisaDir();
  const envPath = path.join(lisaDir, '.env');
  const fileEnv = readEnvFile(envPath);

  // Helper to get value with fallback
  const get = (key: string, fallback: string = ''): string =>
    process.env[key] || fileEnv[key] || fallback;

  const storageMode = get('STORAGE_MODE', 'local') as IEnvConfig['STORAGE_MODE'];

  return {
    STORAGE_MODE: storageMode,

    GRAPHITI_ENDPOINT: get('GRAPHITI_ENDPOINT', 'http://localhost:8010/mcp/'),
    GRAPHITI_GROUP_ID: get('GRAPHITI_GROUP_ID') || undefined,

    NEO4J_URI: get('NEO4J_URI', 'bolt://localhost:7687'),
    NEO4J_USER: get('NEO4J_USER', 'neo4j'),
    NEO4J_PASSWORD: get('NEO4J_PASSWORD', 'demodemo'),
    NEO4J_DATABASE: get('NEO4J_DATABASE', 'neo4j'),

    ZEP_API_KEY: get('ZEP_API_KEY') || undefined,
    ZEP_BASE_URL: get('ZEP_BASE_URL') || undefined,

    LOG_LEVEL: get('LOG_LEVEL', 'error') as IEnvConfig['LOG_LEVEL'],
    LOG_DIR: get('LOG_DIR') || undefined,
    LOG_CONSOLE: get('LOG_CONSOLE', 'false').toLowerCase() === 'true',

    raw: { ...fileEnv, ...process.env } as Record<string, string>,
  };
}

/**
 * Check if Zep Cloud mode is configured and has required settings.
 */
export function isZepCloudConfigured(env: IEnvConfig): boolean {
  return env.STORAGE_MODE === 'zep-cloud' && !!env.ZEP_API_KEY;
}

/**
 * Check if Neo4j direct mode is configured.
 */
export function isNeo4jConfigured(env: IEnvConfig): boolean {
  return env.STORAGE_MODE === 'neo4j';
}

/**
 * Check if local MCP mode is configured (default).
 */
export function isLocalMcpConfigured(env: IEnvConfig): boolean {
  return env.STORAGE_MODE === 'local';
}
