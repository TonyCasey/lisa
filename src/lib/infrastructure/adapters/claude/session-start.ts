#!/usr/bin/env node
/**
 * Claude Code - Session Start Hook (Thin Adapter)
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This is a thin adapter that delegates to SessionStartHandler via mediator.
 *
 * Signal Handling:
 * - SIGINT/SIGTERM handlers ensure graceful exit on process interruption
 * - Prevents blocking CLI when user cancels or system terminates the hook
 */

import { bootstrapContainer, TOKENS } from '../../di';
import type { IMediator } from '../../../application/mediator';
import { SessionStartRequest } from '../../../application/mediator/requests';
import { toISOTimestamp, type SessionTrigger } from '../../../domain';
import { readStdin } from './stdin';

/** Tracks whether a shutdown signal has been received. */
let shutdownRequested = false;

/** Cleanup function set by main() for graceful shutdown. */
let cleanup: (() => Promise<void>) | null = null;

/**
 * Register signal handlers for graceful process termination.
 * Sets exitCode and triggers cleanup rather than hard exit to avoid
 * truncating output or skipping dispose().
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
  // Read hook input to get trigger type
  const hookInput = await readStdin();
  const trigger: SessionTrigger = hookInput.trigger || hookInput.session_type || 'startup';

  // Bootstrap container with DI - use async logging for non-blocking file writes
  const { container, dispose } = await bootstrapContainer({
    projectRoot: process.cwd(),
    asyncLogging: true, // Non-blocking file writes for hook performance
  });

  // Register cleanup for graceful shutdown
  cleanup = dispose;

  try {
    // Check if shutdown was requested during bootstrap
    if (shutdownRequested) return;

    // Resolve mediator and send request
    const mediator = await container.resolve<IMediator>(TOKENS.Mediator);
    const request = new SessionStartRequest(trigger, toISOTimestamp());
    const result = await mediator.send(request);

    // Check if shutdown was requested during processing
    if (shutdownRequested) return;

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
