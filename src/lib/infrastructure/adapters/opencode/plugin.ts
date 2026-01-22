/**
 * Lisa Plugin for OpenCode
 * 
 * This is a thin adapter that delegates to shared handlers via mediator.
 * It translates OpenCode's event system to Lisa's requests.
 */

import { bootstrapContainer, TOKENS } from '../../di';
import type { IMediator } from '../../../application/mediator';
import {
  SessionStartRequest,
  SessionStopRequest,
  PromptSubmitRequest,
} from '../../../application/mediator/requests';
import { toISOTimestamp, PermissionMode } from '../../../domain';
import { OpenCodeEventNames, OpenCodeEventToTrigger } from './opencode-events';
import type { SessionTrigger, SessionStopReason } from '../../../domain';

/**
 * OpenCode Session type (subset of fields we care about)
 */
interface IOpenCodeSession {
  readonly id: string;
  readonly plan?: boolean;
}

/**
 * OpenCode Plugin interface (based on @opencode-ai/plugin types)
 * 
 * Note: We define this locally to avoid a direct dependency on OpenCode.
 * The actual types come from OpenCode's plugin API at runtime.
 */
interface IOpenCodePluginContext {
  readonly project: string;
  readonly directory: string;
  readonly worktree?: string;
  readonly client: IOpenCodeClient;
}

interface IOpenCodeClient {
  readonly app: {
    log(params: { service: string; level: 'info' | 'warn' | 'error'; message: string }): Promise<void>;
  };
  readonly session?: {
    list(): Promise<{ data?: IOpenCodeSession[] }>;
    get(params: { path: { id: string } }): Promise<{ data?: IOpenCodeSession }>;
  };
}

interface ICompactionOutput {
  context: string[];
  prompt?: string;
}

type EventHandler = (input?: unknown, output?: ICompactionOutput) => Promise<void>;

/**
 * Plugin factory function called by OpenCode on load.
 */
export async function LisaPlugin(ctx: IOpenCodePluginContext): Promise<Record<string, EventHandler>> {
  const { directory, client } = ctx;

  // Bootstrap container with DI
  const { container } = await bootstrapContainer({
    projectRoot: directory,
    disableLogging: true,
  });

  // Resolve mediator (singleton - will be reused for all events)
  const mediator = await container.resolve<IMediator>(TOKENS.Mediator);

  // Helper to log messages
  const log = async (level: 'info' | 'warn' | 'error', message: string): Promise<void> => {
    await client.app.log({ service: 'lisa', level, message });
  };

  // Helper to handle session start events
  const handleSessionStart = async (trigger: SessionTrigger): Promise<void> => {
    try {
      const request = new SessionStartRequest(trigger, toISOTimestamp());
      const result = await mediator.send(request);
      await log('info', result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await log('error', `Session start failed: ${message}`);
    }
  };

  return {
    /**
     * SESSION_CREATED: New session started
     */
    [OpenCodeEventNames.SESSION_CREATED]: async () => {
      await handleSessionStart('startup');
    },

    /**
     * SESSION_UPDATED: Session state changed (resume)
     */
    [OpenCodeEventNames.SESSION_UPDATED]: async () => {
      await handleSessionStart('resume');
    },

    /**
     * SESSION_COMPACTED: After context compaction
     */
    [OpenCodeEventNames.SESSION_COMPACTED]: async () => {
      await handleSessionStart('compact');
    },

    /**
     * SESSION_COMPACTING: Hook to inject context during compaction
     * 
     * This is the key hook for injecting Lisa memory into the compacted context.
     * Unlike session.compacted which fires after, this fires during and allows
     * us to push context that will be included in the compacted state.
     */
    [OpenCodeEventNames.SESSION_COMPACTING]: async (_input: unknown, output?: ICompactionOutput) => {
      try {
        const trigger = OpenCodeEventToTrigger[OpenCodeEventNames.SESSION_COMPACTING] as SessionTrigger;
        const request = new SessionStartRequest(trigger, toISOTimestamp());
        const result = await mediator.send(request);

        if (result.contextContent && output) {
          output.context.push(result.contextContent);
        }

        await log('info', 'Context injected during compaction');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await log('error', `Compaction context injection failed: ${message}`);
      }
    },

    /**
     * SESSION_IDLE: Session became idle - good time to capture work
     */
    [OpenCodeEventNames.SESSION_IDLE]: async () => {
      try {
        const request = new SessionStopRequest('idle' as SessionStopReason, toISOTimestamp());
        await mediator.send(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await log('error', `Session capture failed: ${message}`);
      }
    },

    /**
     * MESSAGE_UPDATED: A message was updated (could be user prompt)
     * 
     * Note: We only capture user prompts, not assistant responses.
     * The input object should contain message details including sessionId.
     * 
     * In plan mode, we run memory recursion to surface relevant context.
     */
    [OpenCodeEventNames.MESSAGE_UPDATED]: async (input: unknown) => {
      try {
        // Type guard for message input
        const msg = input as { role?: string; content?: string; sessionId?: string } | undefined;
        if (msg?.role === 'user' && msg?.content) {
          // Check if session is in plan mode
          let permissionMode: PermissionMode = 'default';
          
          if (msg.sessionId && client.session) {
            try {
              const sessionResult = await client.session.get({ path: { id: msg.sessionId } });
              if (sessionResult.data?.plan) {
                permissionMode = 'plan';
              }
            } catch {
              // Ignore session lookup errors - continue with default mode
            }
          }

          const request = new PromptSubmitRequest(msg.content, toISOTimestamp(), msg.sessionId, permissionMode);
          const result = await mediator.send(request);

          // Output recursion results (OpenCode captures stdout for context)
          if (result.recursion?.hasContext) {
            console.log('\n🔍 Related Context from Memory:\n');
            console.log(result.recursion.summary);
            console.log('');
          }
        }
      } catch {
        // Silently ignore prompt capture errors (non-critical)
      }
    },
  };
}

/**
 * Default export for OpenCode plugin loading
 */
export default LisaPlugin;
