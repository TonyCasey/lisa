#!/usr/bin/env node
/**
 * Claude Code - User Prompt Submit Hook (Thin Adapter)
 *
 * Fires when the user submits a prompt.
 * This is a thin adapter that delegates to PromptSubmitHandler.
 * 
 * In plan mode, also runs memory recursion to surface relevant context.
 * 
 * Note: This hook runs fire-and-forget style to avoid blocking the user.
 */

import { createServicesWithCleanup } from '../../di';
import { PromptSubmitHandler } from '../../../application/handlers';
import { PromptSubmitRequest } from '../../../application/mediator/requests';
import { toISOTimestamp, PermissionMode } from '../../../domain';
import { readStdin } from './stdin';

interface IPromptInput {
  prompt?: string;
  content?: string;
  permission_mode?: string;
  permissionMode?: string;
}

async function main(): Promise<void> {
  // Read prompt from stdin
  const input = await readStdin() as IPromptInput;
  const content = input.prompt || input.content || '';
  const permissionMode = (input.permission_mode || input.permissionMode || 'default') as PermissionMode;
  
  if (!content) {
    // No content to process
    process.exit(0);
    return;
  }

  // Create services via DI (with cleanup for connections)
  // Disable pino logging to avoid worker thread issues in bundled hooks
  const services = await createServicesWithCleanup({
    projectRoot: process.cwd(),
    source: 'claude-code',
    disableLogging: true,
  });

  try {
    // Create handler and process request
    const handler = new PromptSubmitHandler(services);
    const request = new PromptSubmitRequest(content, toISOTimestamp(), undefined, permissionMode);
    
    const result = await handler.handle(request);

    // Output recursion results to stdout (Claude context)
    if (result.recursion?.hasContext) {
      console.log('\n🔍 Related Context from Memory:\n');
      console.log(result.recursion.summary);
      console.log('');
    }
  } finally {
    // Clean up connections before exiting
    await services.cleanup();
  }

  // Exit cleanly
  process.exit(0);
}

main().catch(() => {
  // Silent exit on errors - don't block user
  process.exit(0);
});
