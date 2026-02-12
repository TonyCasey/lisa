/**
 * Prompt service - captures user prompts to git-mem.
 *
 * Uses fingerprinting to detect and skip duplicate prompts.
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */
import crypto from 'crypto';
import type { IMemoryService as IGitMemMemoryService } from 'git-mem/dist/index';
import type {
  ISkillPromptService,
  IPromptArgs,
  IPromptResult,
} from './skill-interfaces';

/**
 * Dependencies for creating a skill prompt service.
 */
export interface ISkillPromptServiceDependencies {
  gitMem: IGitMemMemoryService;
}

/**
 * Creates a skill prompt service instance backed by git-mem.
 *
 * @param deps - Service dependencies
 * @returns Skill prompt service implementation
 */
export function createSkillPromptService(deps: ISkillPromptServiceDependencies): ISkillPromptService {
  const { gitMem } = deps;

  return {
    fingerprint(text: string): string {
      return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
    },

    async addPrompt(args: IPromptArgs): Promise<IPromptResult> {
      const { text, role = 'user', source = 'user-prompt', force = false } = args;

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
        fpTag,
        `role:${role}`,
        `source:${source}`,
        'prompt',
      ];

      gitMem.remember(text, { tags });

      return { status: 'ok', action: 'add', role, source };
    },
  };
}
