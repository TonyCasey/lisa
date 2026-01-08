#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - Session Stop Worker (Background)
 *
 * ASYNC BACKGROUND WORKER - Runs detached from main hook
 *
 * This worker:
 * 1. Parses the session transcript
 * 2. Rates work complexity (1-5)
 * 3. Routes to Graphiti (3+) or local logs (1-2)
 *
 * Called by session-stop.ts with input as CLI argument
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Import common modules
const { parseTranscript, findMostRecentTranscript, formatDuration } = require('./common/transcript-parser');
const { rateComplexity, getRatingLabel } = require('./common/complexity-rater');
const { detectRepo, detectBranch } = require('./common/context');

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

interface IComplexityRating {
  rating: 1 | 2 | 3 | 4 | 5;
  rawScore: number;
  signals: string[];
  summary: string;
}

const LOGS_DIR = '.logs';
const WORK_SESSIONS_FILE = 'work-sessions.jsonl';
const ERROR_LOG_FILE = 'stop-hook-errors.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Main worker entry point
 */
async function main(): Promise<void> {
  try {
    // 1. Parse input from CLI argument
    const inputArg = process.argv[2];
    if (!inputArg) {
      logError('No input provided to worker');
      process.exit(0);
    }

    const input: StopHookInput = JSON.parse(inputArg);

    // 2. Change to working directory
    if (input.cwd && fs.existsSync(input.cwd)) {
      process.chdir(input.cwd);
    }

    // 3. Find transcript file
    const transcriptPath = findTranscript(input.transcript_path);
    if (!transcriptPath) {
      logError('Transcript not found', input.transcript_path);
      process.exit(0);
    }

    // 4. Parse transcript
    const work = parseTranscript(transcriptPath);

    // 5. Check if there was any meaningful work
    if (work.filesModified.size === 0 && work.filesCreated.size === 0 && work.commandsRun.length === 0) {
      // No work to capture - exit silently
      process.exit(0);
    }

    // 6. Rate complexity
    const rating = rateComplexity(work);

    // 7. Route based on complexity
    if (rating.rating >= 3) {
      // Significant work -> Graphiti
      await saveToGraphiti(work, rating, input);
    } else {
      // Minor work -> Local logs
      await saveToLocalLogs(work, rating, input);
    }

    // 8. Exit successfully
    process.exit(0);
  } catch (err) {
    const error = err as Error;
    logError('Worker error', error.message);
    process.exit(1);
  }
}

/**
 * Find transcript file, handling known bugs with stale paths
 */
function findTranscript(providedPath: string): string | null {
  // Try provided path first
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }

  // Fall back to finding most recent transcript in the session directory
  if (providedPath) {
    const dir = path.dirname(providedPath);
    const found = findMostRecentTranscript(dir);
    if (found) return found;
  }

  // Try common transcript locations
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const sessionDirs = [
    path.join(homeDir, '.claude', 'projects'),
    path.join(homeDir, '.claude-code', 'sessions'),
  ];

  for (const baseDir of sessionDirs) {
    if (fs.existsSync(baseDir)) {
      const found = findMostRecentTranscript(baseDir);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Save significant work to Graphiti via memory skill
 */
async function saveToGraphiti(
  work: IWorkSummary,
  rating: IComplexityRating,
  input: StopHookInput
): Promise<void> {
  const repo = detectRepo();
  const branch = detectBranch();

  // Build summary text for Graphiti
  const summary = buildGraphitiSummary(work, rating, repo, branch, input.session_id);

  // Find memory skill script
  const memoryScript = path.join(process.cwd(), '.agents/skills/memory/scripts/memory.js');

  if (!fs.existsSync(memoryScript)) {
    // Memory skill not available - fall back to local logs
    logError('Memory skill not found, saving locally');
    await saveToLocalLogs(work, rating, input);
    return;
  }

  // Call memory skill to save
  return new Promise((resolve) => {
    const args = [
      memoryScript,
      'add',
      summary,
      '--group',
      repo || 'agent-memories',
      '--tag',
      'automated',
      '--tag',
      `complexity:${rating.rating}`,
      '--tag',
      'milestone',
      '--tag',
      `session:${input.session_id}`,
      '--source',
      'session-stop',
      '--cache',
    ];

    if (repo) args.push('--tag', `repo:${repo}`);
    if (branch) args.push('--tag', `branch:${branch}`);

    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000, // 10 second timeout
      cwd: process.cwd(),
    });

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      if (code !== 0 && stderr) {
        logError('Memory skill failed', stderr);
        // Fall back to local logs on Graphiti failure
        saveToLocalLogs(work, rating, input).then(resolve);
      } else {
        resolve();
      }
    });

    child.on('error', (err: Error) => {
      logError('Memory skill spawn error', err.message);
      // Fall back to local logs
      saveToLocalLogs(work, rating, input).then(resolve);
    });

    // Timeout handling
    setTimeout(() => {
      try {
        child.kill();
      } catch (_e) {
        // Ignore kill errors
      }
      logError('Memory skill timeout');
      saveToLocalLogs(work, rating, input).then(resolve);
    }, 10000);
  });
}

/**
 * Build summary text for Graphiti storage
 */
function buildGraphitiSummary(
  work: IWorkSummary,
  rating: IComplexityRating,
  repo: string,
  branch: string | null,
  sessionId: string
): string {
  const lines: string[] = [];

  // Header with complexity rating
  lines.push(`MILESTONE [complexity:${rating.rating}]: ${rating.summary}`);
  lines.push('');

  // Session info
  lines.push(`Session: ${sessionId}`);
  if (repo) lines.push(`Repository: ${repo}${branch ? ` (${branch})` : ''}`);
  lines.push(`Duration: ${formatDuration(work.durationMs)}`);
  lines.push(`Timestamp: ${work.timestamp}`);
  lines.push('');

  // Work summary
  lines.push(`Files modified: ${work.filesModified.size}`);
  lines.push(`Files created: ${work.filesCreated.size}`);
  if (work.commandsRun.length > 0) {
    lines.push(`Commands run: ${work.commandsRun.length}`);
  }
  lines.push('');

  // Key changes
  if (work.filesCreated.size > 0 || work.filesModified.size > 0) {
    lines.push('Key changes:');
    const allFiles = [...work.filesCreated].map((f) => `- Created ${f}`);
    allFiles.push(...[...work.filesModified].map((f) => `- Modified ${f}`));
    // Limit to 10 files
    lines.push(...allFiles.slice(0, 10));
    if (allFiles.length > 10) {
      lines.push(`- ... and ${allFiles.length - 10} more`);
    }
    lines.push('');
  }

  // Tools used
  const toolsSummary = Array.from(work.toolsUsed.entries())
    .map(([tool, count]) => `${tool} (${count}x)`)
    .join(', ');
  if (toolsSummary) {
    lines.push(`Tools used: ${toolsSummary}`);
    lines.push('');
  }

  // Complexity signals
  if (rating.signals.length > 0) {
    lines.push(`Signals: ${rating.signals.join(', ')}`);
    lines.push('');
  }

  // Assistant summary (truncated)
  if (work.assistantSummary) {
    lines.push('Summary:');
    lines.push(work.assistantSummary);
  }

  return lines.join('\n');
}

/**
 * Save minor work to local JSONL logs
 */
async function saveToLocalLogs(
  work: IWorkSummary,
  rating: IComplexityRating,
  input: StopHookInput
): Promise<void> {
  const logsDir = path.join(process.cwd(), LOGS_DIR);
  const logsFile = path.join(logsDir, WORK_SESSIONS_FILE);

  // Ensure directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Rotate logs if needed
  rotateLogsIfNeeded(logsFile);

  // Build log entry
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: input.session_id,
    complexity: rating.rating,
    rawScore: rating.rawScore,
    signals: rating.signals,
    summary: rating.summary,
    repo: detectRepo(),
    branch: detectBranch(),
    duration: formatDuration(work.durationMs),
    durationMs: work.durationMs,
    filesModified: Array.from(work.filesModified),
    filesCreated: Array.from(work.filesCreated),
    commandCount: work.commandsRun.length,
    toolsUsed: Object.fromEntries(work.toolsUsed),
    assistantSummary: work.assistantSummary.substring(0, 200),
  };

  // Append to JSONL file
  fs.appendFileSync(logsFile, JSON.stringify(entry) + '\n');
}

/**
 * Rotate log file if it exceeds max size
 */
function rotateLogsIfNeeded(logsFile: string): void {
  if (!fs.existsSync(logsFile)) return;

  try {
    const stats = fs.statSync(logsFile);
    if (stats.size > MAX_LOG_SIZE) {
      const archiveDir = path.join(path.dirname(logsFile), 'archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(archiveDir, `work-sessions-${timestamp}.jsonl`);
      fs.renameSync(logsFile, archivePath);
    }
  } catch (_err) {
    // Ignore rotation errors
  }
}

/**
 * Log error to error log file
 */
function logError(message: string, details?: string): void {
  const logsDir = path.join(process.cwd(), LOGS_DIR);
  const errorLog = path.join(logsDir, ERROR_LOG_FILE);

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${details ? `: ${details}` : ''}\n`;
    fs.appendFileSync(errorLog, entry);
  } catch (_err) {
    // Ignore log errors - don't fail silently
  }
}

// Global error handlers
process.on('uncaughtException', (err: Error) => {
  logError('Uncaught exception', err.stack || err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logError('Unhandled rejection', message);
  process.exit(1);
});

// Run main
main();
