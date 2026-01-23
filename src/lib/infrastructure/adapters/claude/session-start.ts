#!/usr/bin/env node
/**
 * Claude Code - Session Start Hook (Thin Adapter)
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This is a thin adapter that delegates to SessionStartHandler via mediator.
 */

import { bootstrapContainer, TOKENS } from '../../di';
import type { IMediator } from '../../../application/mediator';
import { SessionStartRequest } from '../../../application/mediator/requests';
import { toISOTimestamp, type SessionTrigger } from '../../../domain';
import { readStdin } from './stdin';

async function main(): Promise<void> {
  // Read hook input to get trigger type
  const hookInput = await readStdin();
  const trigger: SessionTrigger = hookInput.trigger || hookInput.session_type || 'startup';

  // Bootstrap container with DI
  const { container, dispose } = await bootstrapContainer({
    projectRoot: process.cwd(),
    disableLogging: true,
  });

  try {
    // Resolve mediator and send request
    const mediator = await container.resolve<IMediator>(TOKENS.Mediator);
    const request = new SessionStartRequest(trigger, toISOTimestamp());
    const result = await mediator.send(request);

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
    await dispose();
  }

  // Exit cleanly - don't let any remaining handles keep process alive
  process.exit(0);
}

main().catch((err: Error) => {
  // Don't block session start on errors - just log and exit cleanly
  console.log(`Memory load skipped: ${err.message}`);
  process.exit(0);
});
