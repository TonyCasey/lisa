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

/**
 * Register signal handlers for graceful process termination.
 * Exits with code 0 to prevent blocking the CLI on interruption.
 */
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main(): Promise<void> {
  // Bootstrap container with DI
  const { container, dispose } = await bootstrapContainer({
    projectRoot: process.cwd(),
    disableLogging: true,
  });

  try {
    // Resolve mediator and send request
    const mediator = await container.resolve<IMediator>(TOKENS.Mediator);
    const request = new SessionStopRequest('idle', toISOTimestamp());
    
    const result = await mediator.send(request);
    
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
