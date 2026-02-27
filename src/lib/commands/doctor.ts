/**
 * Doctor Command Module
 *
 * Diagnostic tool for Lisa configuration.
 * Storage is handled by git-mem (git notes) - no external services needed.
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import type { ICliServices } from './cli-services';

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
  storage: string;
  projectName: string;
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
  verbose?: boolean;
  json?: boolean;
}

// ============================================================================
// Configuration Loading
// ============================================================================

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
 * Check if git is available and we're in a git repository.
 */
async function checkGit(cwd: string): Promise<ICheckResult> {
  const start = Date.now();
  const gitDir = path.join(cwd, '.git');

  if (!await fs.pathExists(gitDir)) {
    return {
      name: 'Git Repository',
      status: 'error',
      message: 'Not a git repository',
      details: 'git-mem requires a git repository. Run "git init" first.',
      durationMs: Date.now() - start,
    };
  }

  return {
    name: 'Git Repository',
    status: 'ok',
    message: 'Git repository detected',
    durationMs: Date.now() - start,
  };
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

/**
 * Check git-mem notes existence.
 */
async function checkGitMem(cwd: string): Promise<ICheckResult> {
  const start = Date.now();
  const notesRef = path.join(cwd, '.git', 'refs', 'notes', 'mem');

  // Check if git notes for memory exist
  const hasNotes = await fs.pathExists(notesRef);

  if (hasNotes) {
    return {
      name: 'Git-Mem Storage',
      status: 'ok',
      message: 'Memory notes found (refs/notes/mem)',
      durationMs: Date.now() - start,
    };
  }

  return {
    name: 'Git-Mem Storage',
    status: 'ok',
    message: 'Ready (no memories stored yet)',
    details: 'Memories will be stored in git notes',
    durationMs: Date.now() - start,
  };
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
  _services: ICliServices
): Promise<IDoctorResult> {
  const startTime = Date.now();
  const cwd = opts.cwd;
  const projectName = getProjectName(cwd);

  // Build config info
  const configInfo: IConfigInfo = {
    storage: 'git-mem',
    projectName,
  };

  // Run health checks
  const checks: ICheckResult[] = [];

  checks.push(await checkGit(cwd));
  checks.push(await checkLisaStructure(cwd));
  checks.push(await checkClaudeHooks(cwd));
  checks.push(await checkGitMem(cwd));

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
  lines.push(chalk.cyan(`Project: ${result.config.projectName}`));
  lines.push(chalk.cyan(`Storage: ${result.config.storage}`));
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
  lines.push(`  Project: ${result.config.projectName}`);
  lines.push(`  Storage: ${result.config.storage}`);
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
  services: ICliServices
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
