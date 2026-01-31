/**
 * Hook Command Module
 *
 * Commands called by Claude Code via settings.json hooks:
 * - session-start: load memory context
 * - session-stop: capture session work
 * - user-prompt-submit: validate/enhance prompts
 */

import type {Command} from 'commander';
import {bootstrapContainer, TOKENS} from '../infrastructure/di';
import type {IMediator} from '../application/mediator';
import {
  SessionStartRequest,
  SessionStopRequest,
  PromptSubmitRequest,
} from '../application/mediator/requests';
import {
  readJsonFromStdin,
  writeJsonToStdout,
  writeStatus,
  parseTrigger,
  type ISessionStartInput,
  type ISessionStopInput,
  type IPromptSubmitInput,
  type IHookOutput,
} from '../infrastructure/cli';
import {toISOTimestamp, type PermissionMode} from '../domain';

export function registerHookCommands(hookCmd: Command): void {
  hookCmd
    .command('session-start')
    .description('Handle session start event (called by Claude Code)')
    .action(async () => {
      let dispose: (() => Promise<void>) | undefined;
      try {
        // Read input from Claude Code
        const input = await readJsonFromStdin<ISessionStartInput>();
        const trigger = parseTrigger(input.source, input.session_type, input.trigger);

        // Bootstrap container and resolve mediator
        const bootstrap = await bootstrapContainer({
          projectRoot: input.cwd || process.cwd(),
          disableLogging: true,
        });
        dispose = bootstrap.dispose;

        const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

        // Create and send request
        const request = new SessionStartRequest(trigger, toISOTimestamp(), input.session_id);
        const result = await mediator.send(request);

        // Output context to stdout (goes to Claude)
        const output: IHookOutput = {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: result.contextContent,
          },
        };
        await writeJsonToStdout(output);

        // Status message to stderr (shown to user)
        await writeStatus(result.message);
      } catch (error) {
        // On error, still output something to not block session
        const errorMessage = error instanceof Error ? error.message : String(error);
        const output: IHookOutput = {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `Memory load skipped: ${errorMessage}`,
          },
        };
        await writeJsonToStdout(output);
        await writeStatus(`Memory load failed: ${errorMessage}`);
      } finally {
        if (dispose) await dispose();
      }
    });

  hookCmd
    .command('session-stop')
    .description('Handle session stop event (called by Claude Code)')
    .action(async () => {
      let dispose: (() => Promise<void>) | undefined;
      try {
        // Read input from Claude Code
        const input = await readJsonFromStdin<ISessionStopInput>();

        // Bootstrap container and resolve mediator
        const bootstrap = await bootstrapContainer({
          projectRoot: input.cwd || process.cwd(),
          disableLogging: true,
        });
        dispose = bootstrap.dispose;

        const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

        // Create and send request
        const request = new SessionStopRequest(
          'idle',
          toISOTimestamp(),
          input.session_id,
          input.transcript_path
        );
        const result = await mediator.send(request);

        // Status message to stderr
        await writeStatus(result.message);
      } catch (error) {
        // Silent failure - don't block user
        const errorMessage = error instanceof Error ? error.message : String(error);
        await writeStatus(`Session capture failed: ${errorMessage}`);
      } finally {
        if (dispose) await dispose();
      }
    });

  hookCmd
    .command('user-prompt-submit')
    .description('Handle user prompt submit event (called by Claude Code)')
    .action(async () => {
      let dispose: (() => Promise<void>) | undefined;
      try {
        // Read input from Claude Code
        const input = await readJsonFromStdin<IPromptSubmitInput>();
        const content = input.prompt || input.content || '';
        const permissionMode = (input.permission_mode || input.permissionMode || 'default') as PermissionMode;

        if (!content) {
          // No content to process
          return;
        }

        // Bootstrap container and resolve mediator
        const bootstrap = await bootstrapContainer({
          projectRoot: process.cwd(),
          disableLogging: true,
        });
        dispose = bootstrap.dispose;

        const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

        // Create and send request
        const request = new PromptSubmitRequest(content, toISOTimestamp(), input.session_id, permissionMode);
        const result = await mediator.send(request);

        // Output recursion results if in plan mode
        if (result.recursion?.hasContext) {
          console.log('\n🔍 Related Context from Memory:\n');
          console.log(result.recursion.summary);
          console.log('');
        }
      } catch {
        // Silent failure - don't block user
      } finally {
        if (dispose) await dispose();
      }
    });
}
