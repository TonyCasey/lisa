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
const { spawn, execSync } = require('child_process');

/**
 * Check if lisa CLI is available
 */
function isLisaAvailable(): boolean {
  try {
    execSync('lisa --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Import common modules
const { parseTranscript, formatDuration } = require('./utils/common/transcript-parser');
const { rateComplexity } = require('./utils/common/complexity-rater');
const { detectRepo, detectBranch } = require('./utils/common/context');

// Import capture modules (refactored)
const { findTranscript } = require('./utils/capture/transcript-finder');
const {
  buildGraphitiSummary,
  buildGraphitiTags,
  buildRetrospectiveTags,
  shouldSaveToGraphiti,
  hasSignificantWork,
} = require('./utils/capture/summary-builder');
const { buildRetrospective, formatRetrospectiveForStorage } = require('./utils/capture/retrospective-builder');
const {
  appendWorkSession,
  logError,
  buildWorkLogEntry,
} = require('./utils/capture/local-logger');

// Types from capture module
import type { IWorkSummary, IComplexityRating } from './utils/capture/summary-builder';

interface IStopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

const MEMORY_SKILL_TIMEOUT_MS = 10000; // 10 seconds

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

    const input: IStopHookInput = JSON.parse(inputArg);

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

    // 5. Check if there was any meaningful work (using refactored helper)
    if (!hasSignificantWork(work)) {
      // No work to capture - exit silently
      process.exit(0);
    }

    // 6. Rate complexity
    const rating = rateComplexity(work);

    // 7. Route based on complexity (using refactored helper)
    if (shouldSaveToGraphiti(rating)) {
      // Significant work -> Graphiti
      await saveToGraphiti(work, rating, input);

      // 7b. Save retrospective learnings for significant work
      await saveRetrospective(work, input);
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
 * Save significant work to Graphiti via memory skill
 */
async function saveToGraphiti(
  work: IWorkSummary,
  rating: IComplexityRating,
  input: IStopHookInput
): Promise<void> {
  const repo = detectRepo();
  const branch = detectBranch();

  // Build summary text for Graphiti using the refactored helper
  const summary = buildGraphitiSummary(work, rating, repo, branch, input.session_id, formatDuration);

  // Build tags using the helper
  const tags = buildGraphitiTags(rating, input.session_id, repo, branch);

  // Check if lisa CLI is available
  if (!isLisaAvailable()) {
    // Lisa CLI not available - fall back to local logs
    logError('Lisa CLI not found, saving locally');
    await saveToLocalLogs(work, rating, input);
    return;
  }

  // Call lisa memory add to save
  return new Promise((resolve) => {
    let resolved = false; // Guard against multiple resolves

    const safeResolve = (): void => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const fallbackAndResolve = async (): Promise<void> => {
      if (resolved) return;
      resolved = true;
      await saveToLocalLogs(work, rating, input);
      resolve();
    };

    const args = [
      'memory',
      'add',
      summary,
      '--group',
      repo || 'agent-memories',
      '--source',
      'session-stop',
      '--cache',
    ];

    // Add all tags from helper
    for (const tag of tags) {
      args.push('--tag', tag);
    }

    const child = spawn('lisa', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: true,
    });

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      if (code !== 0 && stderr) {
        logError('Memory skill failed', stderr);
        // Fall back to local logs on Graphiti failure
        fallbackAndResolve();
      } else {
        safeResolve();
      }
    });

    child.on('error', (err: Error) => {
      logError('Memory skill spawn error', err.message);
      // Fall back to local logs
      fallbackAndResolve();
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      try {
        child.kill();
      } catch (_e) {
        // Ignore kill errors
      }
      logError('Memory skill timeout');
      fallbackAndResolve();
    }, MEMORY_SKILL_TIMEOUT_MS);

    // Clear timeout if resolved normally
    child.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Analyze work and save retrospective learnings
 * Extracts patterns from files created/modified
 */
async function saveRetrospective(work: IWorkSummary, input: IStopHookInput): Promise<void> {
  const allFiles = [...work.filesCreated, ...work.filesModified];
  if (allFiles.length === 0) return;

  // Use the refactored buildRetrospective function
  const patterns = buildRetrospective(allFiles);
  if (!patterns) return;

  const repo = detectRepo();
  
  // Check if lisa CLI is available
  if (!isLisaAvailable()) {
    return;
  }

  // Use the helper to format the retrospective
  const retrospective = formatRetrospectiveForStorage(patterns);

  // Build tags using the helper
  const tags = buildRetrospectiveTags(input.session_id, repo);

  return new Promise((resolve) => {
    const args = [
      'memory',
      'add',
      retrospective,
      '--group',
      repo || 'agent-memories',
      '--source',
      'session-stop-retrospective',
      '--cache',
    ];

    // Add all tags
    for (const tag of tags) {
      args.push('--tag', tag);
    }

    const child = spawn('lisa', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: true,
    });

    child.on('close', () => resolve());
    child.on('error', () => resolve());

    // Timeout after 5 seconds
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore
      }
      resolve();
    }, 5000);
  });
}

/**
 * Save minor work to local JSONL logs
 */
async function saveToLocalLogs(
  work: IWorkSummary,
  rating: IComplexityRating,
  input: IStopHookInput
): Promise<void> {
  const repo = detectRepo();
  const branch = detectBranch();

  // Build log entry using the capture module helper
  const entry = buildWorkLogEntry(
    work,
    rating,
    input.session_id,
    repo,
    branch,
    formatDuration
  );

  // Append to local logs
  appendWorkSession(entry);
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
