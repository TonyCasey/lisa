#!/usr/bin/env node
/**
 * Claude Code - Session Stop Hook (Thin Adapter)
 *
 * Captures session work when Claude stops responding.
 * This is a thin adapter that delegates to SessionStopHandler via mediator.
 *
 * Signal Handling:
 * - SIGINT/SIGTERM handlers ensure graceful exit on process interruption
 * - Prevents blocking CLI when user cancels or system terminates the hook
 */

import { bootstrapContainer, TOKENS } from '../../di';
import type { IMediator } from '../../../application/mediator';
import { SessionStopRequest } from '../../../application/mediator/requests';
import { toISOTimestamp } from '../../../domain';

/** Tracks whether a shutdown signal has been received. */
let shutdownRequested = false;

/** Cleanup function set by main() for graceful shutdown. */
let cleanup: (() => Promise<void>) | null = null;

/**
 * Register signal handlers for graceful process termination.
 * Sets exitCode and triggers cleanup rather than hard exit to avoid
 * skipping session capture or dispose().
 */
async function handleShutdown(): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  process.exitCode = 0;
  if (cleanup) {
    await cleanup();
  }
}

process.on('SIGINT', () => void handleShutdown());
process.on('SIGTERM', () => void handleShutdown());

async function main(): Promise<void> {
  // Bootstrap container with DI
  const { container, dispose } = await bootstrapContainer({
    projectRoot: process.cwd(),
    disableLogging: true,
  });

  // Register cleanup for graceful shutdown
  cleanup = dispose;

  try {
    // Check if shutdown was requested during bootstrap
    if (shutdownRequested) return;

    // Resolve mediator and send request
    const mediator = await container.resolve<IMediator>(TOKENS.Mediator);
    const request = new SessionStopRequest('idle', toISOTimestamp());

    const result = await mediator.send(request);

    // Check if shutdown was requested during processing
    if (shutdownRequested) return;

    if (!result.skipped) {
      console.error(`[Session captured: ${result.factsCaptured} facts]`);
    }
  } finally {
    // Clean up connections before exiting
    await dispose();
  }

  // Exit cleanly
  process.exit(0);
}

main().catch((err: Error) => {
  // Don't block on errors - just exit cleanly
  console.error(`[Session capture skipped: ${err.message}]`);
  process.exit(0);
});
