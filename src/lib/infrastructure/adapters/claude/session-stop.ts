#!/usr/bin/env node
/**
 * Claude Code - Session Stop Hook (Thin Adapter)
 *
 * Captures session work when Claude stops responding.
 * This is a thin adapter that delegates to SessionStopHandler.
 * 
 * Note: The actual implementation spawns a background worker to avoid
 * blocking. This adapter is a placeholder that will need to integrate
 * with the existing worker approach.
 */

import { createServicesWithCleanup } from '../../di';
import { SessionStopHandler } from '../../../application/handlers';
import { toISOTimestamp, createSessionStopEvent } from '../../../domain';

async function main(): Promise<void> {
  // Create services via DI (with cleanup for connections)
  // Disable pino logging to avoid worker thread issues in bundled hooks
  const services = await createServicesWithCleanup({
    projectRoot: process.cwd(),
    source: 'claude-code',
    disableLogging: true,
  });

  try {
    // Create handler and process event
    const handler = new SessionStopHandler(services);
    const event = createSessionStopEvent('idle', toISOTimestamp());
    
    await handler.handle(event);
  } finally {
    // Clean up connections before exiting
    await services.cleanup();
  }

  // Exit cleanly
  process.exit(0);
}

main().catch((err: Error) => {
  // Don't block on errors - just exit cleanly
  console.error(`[Session capture skipped: ${err.message}]`);
  process.exit(0);
});
