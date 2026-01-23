/**
 * Doctor Command Module
 *
 * Comprehensive diagnostic tool for Lisa configuration and connectivity.
 * Supports basic, verbose, and JSON output modes.
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import type { IServices } from '../interfaces/IServices';

// ============================================================================
// Types
// ============================================================================

/**
 * Health check status levels.
 */
export type CheckStatus = 'ok' | 'warning' | 'error';

/**
 * Individual health check result.
 */
export interface ICheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string;
  durationMs?: number;
}

/**
 * Configuration information.
 */
export interface IConfigInfo {
  mode: string;
  group: string;
  endpoint: string;
  envFilePath: string;
  envFileExists: boolean;
  zepApiKeyConfigured: boolean;
  zepProjectId?: string;
}

/**
 * Transcript discovery information.
 */
export interface ITranscriptInfo {
  searchPaths: string[];
  candidates: Array<{
    path: string;
    mtime: Date;
    sizeBytes: number;
  }>;
  selected?: string;
}

/**
 * Complete doctor diagnostic result.
 */
export interface IDoctorResult {
  timestamp: string;
  projectRoot: string;
  version: string;
  overallStatus: CheckStatus;
  config: IConfigInfo;
  checks: ICheckResult[];
  transcripts: ITranscriptInfo;
  totalDurationMs: number;
}

/**
 * Doctor command options.
 */
export interface IDoctorOptions {
  cwd: string;
  compose?: string;
  endpoint?: string;
  verbose?: boolean;
  json?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
const ZEP_CLOUD_ENDPOINT = 'https://api.getzep.com/mcp/';

type DeploymentMode = 'local' | 'zep-cloud' | 'skip';

// ============================================================================
// Configuration Loading
// ============================================================================

interface ILoadedConfig {
  endpoint?: string;
  group?: string;
  mode?: DeploymentMode;
  zepApiKey?: string;
  zepProjectId?: string;
}

/**
 * Load Lisa configuration from .lisa/.env file.
 */
async function loadConfig(cwd: string): Promise<ILoadedConfig | null> {
  const lisaEnv = path.join(cwd, '.lisa', '.env');
  const map: Record<string, string> = {};

  if (await fs.pathExists(lisaEnv)) {
    const raw = await fs.readFile(lisaEnv, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      map[key] = line.slice(idx + 1).trim();
    });
  }

  if (Object.keys(map).length === 0) {
    return null;
  }

  return {
    endpoint: map.GRAPHITI_ENDPOINT,
    group: map.GRAPHITI_GROUP_ID,
    mode: map.STORAGE_MODE as DeploymentMode | undefined,
    zepApiKey: map.ZEP_API_KEY,
    zepProjectId: map.ZEP_PROJECT_ID,
  };
}

/**
 * Get project name from package.json or directory name.
 */
function getProjectName(cwd: string): string {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = fs.readJsonSync(pkgPath);
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch {
    // Ignore
  }
  return path.basename(cwd);
}

/**
 * Get Lisa package version.
 */
function getLisaVersion(): string {
  try {
    // Try multiple locations for package.json
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', 'package.json'),
      path.join(__dirname, '..', '..', 'package.json'),
    ];
    for (const pkgPath of possiblePaths) {
      if (fs.existsSync(pkgPath)) {
        const pkg = fs.readJsonSync(pkgPath);
        return pkg.version || '0.0.0';
      }
    }
  } catch {
    // Ignore
  }
  return '0.0.0';
}

// ============================================================================
// Health Checks
// ============================================================================

/**
 * Check Docker availability.
 */
async function checkDocker(services: IServices): Promise<ICheckResult> {
  const start = Date.now();
  try {
    const version = await services.docker.version();
    return {
      name: 'Docker',
      status: 'ok',
      message: `Docker ${version.trim()}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker not available',
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check Docker Compose availability.
 */
async function checkDockerCompose(services: IServices): Promise<ICheckResult> {
  const start = Date.now();
  try {
    const version = await services.docker.composeVersion();
    return {
      name: 'Docker Compose',
      status: 'ok',
      message: `Compose ${version.trim()}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Docker Compose',
      status: 'error',
      message: 'Docker Compose not available',
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check compose file existence.
 */
async function checkComposeFile(composeFile: string): Promise<ICheckResult> {
  const start = Date.now();
  const exists = await fs.pathExists(composeFile);
  return {
    name: 'Compose File',
    status: exists ? 'ok' : 'warning',
    message: exists ? `Found: ${path.basename(composeFile)}` : 'Not found',
    details: composeFile,
    durationMs: Date.now() - start,
  };
}

/**
 * Check MCP/Graphiti connectivity.
 */
async function checkMcp(
  services: IServices,
  endpoint: string,
  apiKey?: string
): Promise<ICheckResult> {
  const start = Date.now();
  try {
    await services.mcp.ping(endpoint, { apiKey });
    return {
      name: 'MCP Server',
      status: 'ok',
      message: `Reachable at ${endpoint}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'MCP Server',
      status: 'error',
      message: `Not reachable at ${endpoint}`,
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check Neo4j connectivity (local mode only).
 */
async function checkNeo4j(): Promise<ICheckResult> {
  const start = Date.now();
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';

  try {
    // Dynamic import to avoid requiring neo4j-driver if not needed
    const neo4j = await import('neo4j-driver');
    const driver = neo4j.default.driver(
      uri,
      neo4j.default.auth.basic(
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'demodemo'
      ),
      { connectionTimeout: 5000 }
    );

    await driver.verifyConnectivity();
    await driver.close();

    return {
      name: 'Neo4j',
      status: 'ok',
      message: `Connected to ${uri}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Neo4j',
      status: 'error',
      message: `Cannot connect to ${uri}`,
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check Zep Cloud connectivity.
 */
async function checkZepCloud(apiKey: string): Promise<ICheckResult> {
  const start = Date.now();
  const endpoint = 'https://api.getzep.com/api/v2/users';

  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    // 200 or 404 means API is reachable
    if (resp.ok || resp.status === 404) {
      return {
        name: 'Zep Cloud',
        status: 'ok',
        message: 'API reachable',
        durationMs: Date.now() - start,
      };
    }

    return {
      name: 'Zep Cloud',
      status: 'error',
      message: `API returned ${resp.status}`,
      details: await resp.text().catch(() => ''),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Zep Cloud',
      status: 'error',
      message: 'Cannot reach Zep Cloud API',
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check .lisa directory structure.
 */
async function checkLisaStructure(cwd: string): Promise<ICheckResult> {
  const start = Date.now();
  const lisaDir = path.join(cwd, '.lisa');

  if (!(await fs.pathExists(lisaDir))) {
    return {
      name: 'Lisa Structure',
      status: 'error',
      message: '.lisa directory not found',
      details: 'Run "lisa init" to set up Lisa',
      durationMs: Date.now() - start,
    };
  }

  const expectedDirs = ['skills', 'rules'];
  const missing: string[] = [];

  for (const dir of expectedDirs) {
    if (!(await fs.pathExists(path.join(lisaDir, dir)))) {
      missing.push(dir);
    }
  }

  if (missing.length > 0) {
    return {
      name: 'Lisa Structure',
      status: 'warning',
      message: `Missing directories: ${missing.join(', ')}`,
      details: `Expected in ${lisaDir}`,
      durationMs: Date.now() - start,
    };
  }

  return {
    name: 'Lisa Structure',
    status: 'ok',
    message: '.lisa directory configured',
    durationMs: Date.now() - start,
  };
}

/**
 * Check Claude Code hooks setup.
 */
async function checkClaudeHooks(cwd: string): Promise<ICheckResult> {
  const start = Date.now();
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!(await fs.pathExists(claudeDir))) {
    return {
      name: 'Claude Code Hooks',
      status: 'warning',
      message: '.claude directory not found',
      details: 'Claude Code integration not configured',
      durationMs: Date.now() - start,
    };
  }

  if (!(await fs.pathExists(settingsPath))) {
    return {
      name: 'Claude Code Hooks',
      status: 'warning',
      message: 'settings.json not found',
      details: 'Hooks may not be registered',
      durationMs: Date.now() - start,
    };
  }

  try {
    const settings = await fs.readJson(settingsPath);
    const hooks = settings.hooks || {};
    const configuredHooks = Object.keys(hooks).length;

    if (configuredHooks === 0) {
      return {
        name: 'Claude Code Hooks',
        status: 'warning',
        message: 'No hooks configured',
        details: 'Memory loading may not work',
        durationMs: Date.now() - start,
      };
    }

    return {
      name: 'Claude Code Hooks',
      status: 'ok',
      message: `${configuredHooks} hook(s) configured`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'Claude Code Hooks',
      status: 'warning',
      message: 'Cannot parse settings.json',
      details: message,
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Transcript Discovery
// ============================================================================

/**
 * Find all transcript files from standard Claude Code locations.
 */
function findTranscripts(): ITranscriptInfo {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const searchPaths = [
    path.join(homeDir, '.claude', 'projects'),
    path.join(homeDir, '.claude'),
  ];

  const candidates: ITranscriptInfo['candidates'] = [];

  for (const dir of searchPaths) {
    if (!fs.existsSync(dir)) continue;

    // Check direct transcript
    const directPath = path.join(dir, 'transcript.jsonl');
    if (fs.existsSync(directPath)) {
      try {
        const stats = fs.statSync(directPath);
        candidates.push({
          path: directPath,
          mtime: stats.mtime,
          sizeBytes: stats.size,
        });
      } catch {
        // Skip
      }
    }

    // Check subdirectories
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(dir, entry.name, 'transcript.jsonl');
          if (fs.existsSync(subPath)) {
            try {
              const stats = fs.statSync(subPath);
              candidates.push({
                path: subPath,
                mtime: stats.mtime,
                sizeBytes: stats.size,
              });
            } catch {
              // Skip
            }
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  // Sort by modification time (newest first)
  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return {
    searchPaths,
    candidates,
    selected: candidates.length > 0 ? candidates[0].path : undefined,
  };
}

// ============================================================================
// Main Doctor Function
// ============================================================================

/**
 * Run comprehensive health checks and return diagnostic results.
 */
export async function runDoctor(
  opts: IDoctorOptions,
  services: IServices
): Promise<IDoctorResult> {
  const startTime = Date.now();
  const cwd = opts.cwd;
  const projectName = getProjectName(cwd);

  // Load configuration
  const config = await loadConfig(cwd);
  const mode = config?.mode || 'local';
  const endpoint =
    opts.endpoint ||
    config?.endpoint ||
    (mode === 'zep-cloud' ? ZEP_CLOUD_ENDPOINT : DEFAULT_ENDPOINT);
  const group = config?.group || projectName;
  const zepApiKey = config?.zepApiKey || process.env.ZEP_API_KEY;

  // Build config info
  const envFilePath = path.join(cwd, '.lisa', '.env');
  const configInfo: IConfigInfo = {
    mode,
    group,
    endpoint,
    envFilePath,
    envFileExists: await fs.pathExists(envFilePath),
    zepApiKeyConfigured: !!zepApiKey,
    zepProjectId: config?.zepProjectId,
  };

  // Run health checks based on mode
  const checks: ICheckResult[] = [];

  // Always check Lisa structure and Claude hooks
  checks.push(await checkLisaStructure(cwd));
  checks.push(await checkClaudeHooks(cwd));

  if (mode === 'local') {
    // Local mode checks
    checks.push(await checkDocker(services));
    checks.push(await checkDockerCompose(services));

    const composeFile =
      opts.compose || path.join(cwd, 'docker-compose.graphiti.yml');
    checks.push(await checkComposeFile(composeFile));

    checks.push(await checkNeo4j());
    checks.push(await checkMcp(services, endpoint));
  } else if (mode === 'zep-cloud') {
    // Zep Cloud mode checks
    if (zepApiKey) {
      checks.push(await checkZepCloud(zepApiKey));
      checks.push(await checkMcp(services, endpoint, zepApiKey));
    } else {
      checks.push({
        name: 'Zep Cloud',
        status: 'error',
        message: 'ZEP_API_KEY not configured',
        details: 'Set ZEP_API_KEY in .lisa/.env or environment',
      });
    }
  } else if (mode === 'skip') {
    checks.push({
      name: 'Storage Backend',
      status: 'warning',
      message: 'Storage not configured (skip mode)',
      details: 'Run "lisa init" to configure storage',
    });
  }

  // Find transcripts
  const transcripts = findTranscripts();

  // Determine overall status
  const hasError = checks.some((c) => c.status === 'error');
  const hasWarning = checks.some((c) => c.status === 'warning');
  const overallStatus: CheckStatus = hasError
    ? 'error'
    : hasWarning
      ? 'warning'
      : 'ok';

  return {
    timestamp: new Date().toISOString(),
    projectRoot: cwd,
    version: getLisaVersion(),
    overallStatus,
    config: configInfo,
    checks,
    transcripts,
    totalDurationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Get status icon for check result.
 */
function getStatusIcon(status: CheckStatus): string {
  switch (status) {
    case 'ok':
      return chalk.green('✓');
    case 'warning':
      return chalk.yellow('⚠');
    case 'error':
      return chalk.red('✗');
  }
}

/**
 * Get colored status text.
 */
function getStatusText(status: CheckStatus): string {
  switch (status) {
    case 'ok':
      return chalk.green('OK');
    case 'warning':
      return chalk.yellow('WARNING');
    case 'error':
      return chalk.red('ERROR');
  }
}

/**
 * Format file size in human-readable format.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration in human-readable format.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format basic output (checkmarks only).
 */
export function formatBasicOutput(result: IDoctorResult): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.cyan(`Mode: ${result.config.mode}`));
  lines.push(chalk.cyan(`Group: ${result.config.group}`));
  lines.push('');

  // Health checks
  for (const check of result.checks) {
    lines.push(`${getStatusIcon(check.status)} ${check.name}: ${check.message}`);
  }

  // Overall status
  lines.push('');
  lines.push(
    `Overall: ${getStatusText(result.overallStatus)} (${formatDuration(result.totalDurationMs)})`
  );

  return lines.join('\n');
}

/**
 * Format verbose output (detailed diagnostics).
 */
export function formatVerboseOutput(result: IDoctorResult): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold.cyan('=== Lisa Doctor ==='));
  lines.push('');

  // System info
  lines.push(chalk.bold('System Information'));
  lines.push(`  Lisa Version: ${result.version}`);
  lines.push(`  Project Root: ${result.projectRoot}`);
  lines.push(`  Timestamp: ${result.timestamp}`);
  lines.push('');

  // Configuration
  lines.push(chalk.bold('Configuration'));
  lines.push(`  Mode: ${result.config.mode}`);
  lines.push(`  Group: ${result.config.group}`);
  lines.push(`  Endpoint: ${result.config.endpoint}`);
  lines.push(`  Env File: ${result.config.envFilePath}`);
  lines.push(`  Env File Exists: ${result.config.envFileExists ? 'Yes' : 'No'}`);
  lines.push(
    `  Zep API Key: ${result.config.zepApiKeyConfigured ? 'Configured' : 'Not configured'}`
  );
  if (result.config.zepProjectId) {
    lines.push(`  Zep Project ID: ${result.config.zepProjectId}`);
  }
  lines.push('');

  // Health checks with timing
  lines.push(chalk.bold('Health Checks'));
  for (const check of result.checks) {
    const timing = check.durationMs ? ` (${formatDuration(check.durationMs)})` : '';
    lines.push(`  ${getStatusIcon(check.status)} ${check.name}: ${check.message}${timing}`);
    if (check.details) {
      lines.push(`      ${chalk.dim(check.details)}`);
    }
  }
  lines.push('');

  // Transcript discovery
  lines.push(chalk.bold('Transcript Discovery'));
  lines.push(`  Search Paths:`);
  for (const searchPath of result.transcripts.searchPaths) {
    const exists = fs.existsSync(searchPath);
    lines.push(`    ${exists ? chalk.green('✓') : chalk.dim('-')} ${searchPath}`);
  }
  lines.push('');

  if (result.transcripts.candidates.length > 0) {
    lines.push(`  Found ${result.transcripts.candidates.length} transcript(s):`);
    for (const candidate of result.transcripts.candidates) {
      const isSelected = candidate.path === result.transcripts.selected;
      const prefix = isSelected ? chalk.green('→') : ' ';
      const date = candidate.mtime.toISOString().replace('T', ' ').slice(0, 19);
      lines.push(
        `    ${prefix} ${candidate.path}`
      );
      lines.push(
        `      ${chalk.dim(`Modified: ${date}, Size: ${formatSize(candidate.sizeBytes)}`)}`
      );
    }
  } else {
    lines.push(`  ${chalk.yellow('No transcripts found')}`);
  }
  lines.push('');

  // Summary
  lines.push(chalk.bold('Summary'));
  const checkCounts = {
    ok: result.checks.filter((c) => c.status === 'ok').length,
    warning: result.checks.filter((c) => c.status === 'warning').length,
    error: result.checks.filter((c) => c.status === 'error').length,
  };
  lines.push(
    `  Checks: ${chalk.green(checkCounts.ok + ' passed')}, ${chalk.yellow(checkCounts.warning + ' warnings')}, ${chalk.red(checkCounts.error + ' errors')}`
  );
  lines.push(`  Total Duration: ${formatDuration(result.totalDurationMs)}`);
  lines.push('');
  lines.push(`Overall Status: ${getStatusText(result.overallStatus)}`);

  return lines.join('\n');
}

/**
 * Format JSON output.
 */
export function formatJsonOutput(result: IDoctorResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get exit code based on overall status.
 * 0 = ok, 1 = warning, 2 = error
 */
export function getExitCode(status: CheckStatus): number {
  switch (status) {
    case 'ok':
      return 0;
    case 'warning':
      return 1;
    case 'error':
      return 2;
  }
}

// ============================================================================
// Exported Command Handler
// ============================================================================

/**
 * Execute the doctor command with specified options.
 */
export async function doctorCommand(
  opts: IDoctorOptions,
  services: IServices
): Promise<void> {
  const result = await runDoctor(opts, services);

  // Format and output
  if (opts.json) {
    console.log(formatJsonOutput(result));
  } else if (opts.verbose) {
    console.log(formatVerboseOutput(result));
  } else {
    console.log(formatBasicOutput(result));
  }

  // Set exit code
  process.exitCode = getExitCode(result.overallStatus);
}
