/**
 * Session Stop Hook Handler
 * 
 * CLI command: lisa hook session-stop
 * 
 * Captures session work and saves to memory when Claude Code stops.
 * This hook must exit quickly (<50ms) so it spawns a background worker.
 * 
 * Reads JSON from stdin, outputs decision to stdout.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Readable, Writable } from 'stream';
import type { ISessionStopHookInput, ISessionStopHookOutput } from './types';
import { readJsonStdin, writeJsonStdout } from './utils';

/**
 * Handler for session stop events via CLI.
 * Spawns a background worker to capture work asynchronously.
 */
export class SessionStopHookHandler {
  /**
   * Execute the hook handler.
   * Must exit quickly - spawns background worker for heavy lifting.
   */
  async execute(
    stdin: Readable = process.stdin,
    stdout: Writable = process.stdout,
    _stderr: Writable = process.stderr
  ): Promise<void> {
    try {
      // 1. Read hook input from stdin
      const input = await readJsonStdin<ISessionStopHookInput>(stdin);

      // 2. Safety: prevent infinite loops
      if (input.stop_hook_active) {
        const output: ISessionStopHookOutput = {
          continue: false,
          stopReason: 'Stop hook already active',
        };
        await writeJsonStdout(output, stdout);
        return;
      }

      // 3. Determine working directory
      const cwd = input.cwd || process.cwd();

      // 4. Spawn background worker to capture work
      await this.spawnWorker(input, cwd);

      // 5. Exit immediately with response
      const output: ISessionStopHookOutput = {
        continue: false,
        stopReason: 'Work capture queued in background',
      };
      await writeJsonStdout(output, stdout);
    } catch (error) {
      // On error, still exit cleanly
      const output: ISessionStopHookOutput = {
        continue: false,
        stopReason: error instanceof Error ? error.message : 'Unknown error',
      };
      await writeJsonStdout(output, stdout);
    }
  }

  /**
   * Spawn a detached background worker to capture session work.
   */
  private async spawnWorker(input: ISessionStopHookInput, cwd: string): Promise<void> {
    // Find the worker script - it's part of the lisa package
    const workerPath = this.findWorkerScript();
    
    if (!workerPath || !fs.existsSync(workerPath)) {
      // Worker not found - silently skip
      return;
    }

    // Prepare input for worker
    const workerInput = JSON.stringify({
      session_id: input.session_id || 'unknown',
      transcript_path: input.transcript_path || '',
      cwd: cwd,
    });

    try {
      const worker = spawn(
        process.execPath, // Use the same Node.js that's running this
        [workerPath, workerInput],
        {
          detached: true,
          stdio: 'ignore',
          cwd: cwd,
          env: {
            ...process.env,
            STOP_HOOK_WORKER: 'true',
          },
        }
      );

      // Unref to allow parent to exit independently
      worker.unref();
    } catch {
      // Spawn failed - silently continue
    }
  }

  /**
   * Find the session stop worker script.
   */
  private findWorkerScript(): string | null {
    // The worker is compiled alongside the CLI
    const possiblePaths = [
      // In dist/lib/application/handlers/hooks/
      path.join(__dirname, 'session-stop-worker.js'),
      // In the hooks directory
      path.join(__dirname, '..', '..', '..', '..', 'hooks', 'session-stop-worker.js'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }
}
