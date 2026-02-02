#!/usr/bin/env node
/**
 * Claude Code - User Prompt Submit Hook (Thin Adapter)
 *
 * Fires when the user submits a prompt.
 * This is a thin adapter that delegates to PromptSubmitHandler via mediator.
 * 
 * In plan mode, also runs memory recursion to surface relevant context.
 * 
 * Note: This hook runs fire-and-forget style to avoid blocking the user.
 */

import { bootstrapContainer, TOKENS } from '../../di';
import type { IMediator } from '../../../application/mediator';
import { PromptSubmitRequest } from '../../../application/mediator/requests';
import { toISOTimestamp, PermissionMode } from '../../../domain';
import { readStdin } from './stdin';

interface IPromptInput {
  prompt?: string;
  content?: string;
  permission_mode?: string;
  permissionMode?: string;
  previous_assistant_message?: string;
  previousAssistantMessage?: string;
}

async function main(): Promise<void> {
  // Read prompt from stdin
  const input = await readStdin() as IPromptInput;
  const content = input.prompt || input.content || '';
  const permissionMode = (input.permission_mode || input.permissionMode || 'default') as PermissionMode;
  const previousAssistantMessage = input.previous_assistant_message || input.previousAssistantMessage;
  
  if (!content) {
    // No content to process
    process.exit(0);
    return;
  }

  // Bootstrap container with DI
  const { container, dispose } = await bootstrapContainer({
    projectRoot: process.cwd(),
    disableLogging: true,
  });

  try {
    // Resolve mediator and send request
    const mediator = await container.resolve<IMediator>(TOKENS.Mediator);
    const request = new PromptSubmitRequest(content, toISOTimestamp(), undefined, permissionMode, previousAssistantMessage);
    
    const result = await mediator.send(request);

    // Output recursion results to stdout (Claude context)
    if (result.recursion?.hasContext) {
      console.log('\n🔍 Related Context from Memory:\n');
      console.log(result.recursion.summary);
      console.log('');
    }
  } finally {
    // Clean up connections before exiting
    await dispose();
  }

  // Exit cleanly
  process.exit(0);
}

main().catch(() => {
  // Silent exit on errors - don't block user
  process.exit(0);
});
