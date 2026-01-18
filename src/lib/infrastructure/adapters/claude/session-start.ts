#!/usr/bin/env node
/**
 * Claude Code - Session Start Hook (Thin Adapter)
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This is a thin adapter that delegates to SessionStartHandler.
 */

import { createServicesWithCleanup } from '../../di';
import { SessionStartHandler } from '../../../application/handlers';
import { toISOTimestamp, createSessionStartEvent, SessionTrigger } from '../../../domain';
import { readStdin } from './stdin';

async function main(): Promise<void> {
  // Read hook input to get trigger type
  const hookInput = await readStdin();
  const trigger: SessionTrigger = hookInput.trigger || hookInput.session_type || 'startup';

  // Create services via DI (with cleanup for connections)
  // Disable pino logging to avoid worker thread issues in bundled hooks
  const services = await createServicesWithCleanup({
    projectRoot: process.cwd(),
    source: 'claude-code',
    disableLogging: true,
  });

  try {
    // Create handler and process event
    const handler = new SessionStartHandler(services);
    const event = createSessionStartEvent(trigger, toISOTimestamp());
    const result = await handler.handle(event);

    // Output goes to Claude as system-reminder context (stdout)
    console.log(result.contextContent);

    // Visible confirmation to user (stderr) - brief summary
    const itemCount = result.memories.facts.length || result.memories.nodes.length;
    const taskCount = result.tasks.length;
    let summary = itemCount || taskCount ? `${itemCount} memories, ${taskCount} tasks` : 'no prior context';
    if (result.timedOut) {
      summary += ' (partial)';
    }
    const triggerLabel = trigger === 'startup' ? '' : ` (${trigger})`;
    console.error(`[Memory loaded${triggerLabel}: ${summary}]`);
  } finally {
    // Clean up connections before exiting
    await services.cleanup();
  }

  // Exit cleanly - don't let any remaining handles keep process alive
  process.exit(0);
}

main().catch((err: Error) => {
  // Don't block session start on errors - just log and exit cleanly
  console.log(`Memory load skipped: ${err.message}`);
  process.exit(0);
});
