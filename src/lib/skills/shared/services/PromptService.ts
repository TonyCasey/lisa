/**
 * Prompt service - captures user prompts to git-mem.
 */
import crypto from 'crypto';
import type { IMemoryService as IGitMemMemoryService } from 'git-mem/dist/index';

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
  gitMem: IGitMemMemoryService;
}

/**
 * Creates a prompt service instance backed by git-mem.
 */
export function createPromptService(deps: IPromptServiceDependencies): IPromptService {
  const { gitMem } = deps;

  return {
    fingerprint(text: string): string {
      return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
    },

    async addPrompt(args: IPromptArgs): Promise<IPromptResult> {
      const { text, role = 'user', source = 'user-prompt', force = false, groupId } = args;

      if (!text) throw new Error('prompt requires text');

      const fp = this.fingerprint(text);
      const fpTag = `fingerprint:${fp}`;

      // Check for duplicates unless force
      if (!force) {
        const { memories } = gitMem.recall(undefined, { limit: 200 });
        const duplicate = memories.some(m => m.tags.includes(fpTag));
        if (duplicate) {
          return { status: 'skipped', reason: 'duplicate' };
        }
      }

      const tags = [
        `group:${groupId}`,
        fpTag,
        `role:${role}`,
        `source:${source}`,
        'prompt',
      ];

      gitMem.remember(text, { tags });

      return { status: 'ok', action: 'add', group: groupId, role, source };
    },
  };
}
