#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - Session Stop Hook (Main)
 *
 * FAST EXIT HOOK - Must exit in < 50ms
 *
 * This hook spawns a detached background worker to analyze the session
 * and capture work to Graphiti or local logs. The main hook exits
 * immediately to avoid blocking the CLI.
 *
 * Architecture:
 * 1. Main Hook (this file) - Spawns worker, exits fast
 * 2. Background Worker (session-stop-worker.js) - Does heavy lifting async
 *
 * Configuration: .claude/settings.json -> hooks.Stop
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const STDIN_TIMEOUT_MS = 100; // Max time to wait for stdin

interface IStopHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/**
 * Read JSON input from stdin
 */
async function readStdin(): Promise<IStopHookInput> {
  return new Promise((resolve) => {
    let input = '';

    // Set a short timeout for reading stdin
    const timeout = setTimeout(() => {
      resolve({});
    }, STDIN_TIMEOUT_MS);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(input));
      } catch (_err) {
        resolve({});
      }
    });

    // Handle case where stdin is already closed
    if (process.stdin.readableEnded) {
      clearTimeout(timeout);
      resolve({});
    }
  });
}

/**
 * Main hook entry point
 * MUST exit within 50ms to avoid blocking CLI
 */
async function main(): Promise<void> {
  // 1. Read input from stdin
  const input = await readStdin();

  // 2. Safety: prevent infinite loops
  if (input.stop_hook_active) {
    console.log(JSON.stringify({ continue: false }));
    process.exit(0);
  }

  // 3. Determine working directory
  const cwd = input.cwd || process.cwd();

  // 4. Find the worker script
  const workerPath = path.join(__dirname, 'session-stop-worker.js');

  // Check if worker exists
  if (!fs.existsSync(workerPath)) {
    // Worker not deployed yet - exit silently
    console.log(
      JSON.stringify({
        continue: false,
        stopReason: 'Worker not found',
      })
    );
    process.exit(0);
  }

  // 5. Prepare input for worker
  const workerInput = JSON.stringify({
    session_id: input.session_id || 'unknown',
    transcript_path: input.transcript_path || '',
    cwd: cwd,
  });

  // 6. Spawn detached background worker
  try {
    const worker = spawn(
      'node',
      [workerPath, workerInput],
      {
        detached: true, // Detach from parent process
        stdio: 'ignore', // Don't wait for I/O
        cwd: cwd, // Worker runs in project directory
        env: {
          ...process.env,
          STOP_HOOK_WORKER: 'true', // Mark as worker process
        },
      }
    );

    // Unref to allow parent to exit independently
    worker.unref();
  } catch (_err) {
    // Spawn failed - exit silently, don't block CLI
  }

  // 7. Exit immediately
  console.log(
    JSON.stringify({
      continue: false,
      stopReason: 'Work capture queued in background',
    })
  );

  process.exit(0);
}

// Run main with error handling
// CRITICAL: Never block - exit cleanly even on error
main().catch((err: Error) => {
  // Log error for debugging but don't block
  const errorLog = '/tmp/claude-stop-hook-error.log';
  try {
    fs.appendFileSync(errorLog, `[${new Date().toISOString()}] ${err.message}\n`);
  } catch (_writeErr) {
    // Ignore write errors
  }

  // Always exit cleanly
  console.log(JSON.stringify({ continue: false }));
  process.exit(0);
});
