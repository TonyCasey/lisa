/**
 * Prompt service - captures user prompts to Graphiti MCP.
 */
import crypto from 'crypto';
import type { IMcpClient } from '../clients/interfaces/IMcpClient';

// ============================================================================
// Types
// ============================================================================

export interface IPromptArgs {
  text: string;
  role?: string;
  source?: string;
  force?: boolean;
  groupId: string;
}

export interface IPromptResult {
  status: 'ok' | 'skipped';
  action?: 'add';
  group?: string;
  role?: string;
  source?: string;
  reason?: string;
}

export interface IPromptService {
  fingerprint(text: string): string;
  addPrompt(args: IPromptArgs): Promise<IPromptResult>;
}

export interface IPromptServiceDependencies {
  mcpClient: IMcpClient;
}

/**
 * Creates a prompt service instance.
 */
export function createPromptService(deps: IPromptServiceDependencies): IPromptService {
  const { mcpClient } = deps;

  return {
    fingerprint(text: string): string {
      return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
    },

    async addPrompt(args: IPromptArgs): Promise<IPromptResult> {
      const { text, role = 'user', source = 'user-prompt', force = false, groupId } = args;

      if (!text) throw new Error('prompt requires text');

      const fp = this.fingerprint(text);
      const fpTag = `fingerprint:${fp}`;

      await mcpClient.initialize();

      // Check for duplicates unless force
      if (!force) {
        try {
          const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
          const existing = await mcpClient.rpcCall<{ nodes?: unknown[] }>('search_nodes', searchParams);
          const nodes = existing?.nodes || [];
          if (nodes.length > 0) {
            return { status: 'skipped', reason: 'duplicate' };
          }
        } catch {
          // Ignore dedupe errors
        }
      }

      const params = {
        name: text.substring(0, 100),
        episode_body: text,
        source,
        group_id: groupId,
        tags: [fpTag, `role:${role}`, `source:${source}`],
      };

      await mcpClient.rpcCall('add_memory', params);

      return { status: 'ok', action: 'add', group: groupId, role, source };
    },
  };
}
