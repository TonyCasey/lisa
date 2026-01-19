#!/usr/bin/env node
/**
 * Prompt Capture CLI - thin entry point.
 *
 * Stores user prompts as episodes in Graphiti MCP.
 *
 * Usage: node prompt.js --text "prompt text" [--role user] [--source user-prompt] [--force]
 */

export {};

async function main(): Promise<void> {
  const { loadEnv } = await import('../shared/utils/env');
  const { getCurrentGroupId } = await import('../shared/group-id');
  const { popFlag, hasFlag } = await import('../shared/utils/cli');
  const { createMcpClient, createMcpConfigFromEnv } = await import('../shared/clients');
  const { createPromptService } = await import('../shared/services');

  const env = loadEnv();
  const args = process.argv.slice(2);

  const explicitGroup = popFlag(args, '--group', null);
  const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();
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

  const mcpClient = createMcpClient(createMcpConfigFromEnv(env.raw));
  const service = createPromptService({ mcpClient });

  try {
    const result = await service.addPrompt({ text, role, source, force, groupId });

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
