#!/usr/bin/env node
/**
 * Prompt Capture CLI - thin entry point.
 *
 * Stores user prompts as memories in git-mem.
 *
 * Usage: node prompt.js --text "prompt text" [--role user] [--source user-prompt] [--force]
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */

export {};

async function main(): Promise<void> {
  const { popFlag, hasFlag } = await import('../shared/utils/cli');
  const { createGitMem } = await import('../shared/clients');
  const { createPromptService } = await import('../shared/services');

  const args = process.argv.slice(2);

  // --group flag is ignored but still consumed for backwards compatibility
  popFlag(args, '--group', null);
  const text = popFlag(args, '--text', null) || popFlag(args, '-t', null);
  const role = popFlag(args, '--role', 'user') || popFlag(args, '-r', 'user');
  const source = popFlag(args, '--source', 'user-prompt') || popFlag(args, '-s', 'user-prompt');
  const force = hasFlag(args, '--force');

  // Skip legacy --kind flag
  popFlag(args, '--kind', null);
  popFlag(args, '-k', null);

  if (!text) {
    console.error('prompt requires --text');
    process.exit(1);
  }

  const gitMem = createGitMem();
  const service = createPromptService({ gitMem });

  try {
    const result = await service.addPrompt({ text, role, source, force });

    if (result.status === 'skipped') {
      console.log('Duplicate prompt; skipping (use --force to override).');
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
