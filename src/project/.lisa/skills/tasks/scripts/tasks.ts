#!/usr/bin/env node
/**
 * Task management CLI - thin entry point.
 *
 * Commands:
 *   node tasks.js list [--group <id>] [--limit N] [--cache]
 *   node tasks.js add "task text" [--status todo|doing|done] [--tag foo] [--group <id>] [--cache]
 *   node tasks.js update "task text" [--status ...] [--tag foo] [--group <id>] [--cache]
 */

export {};

import path from 'path';

async function main(): Promise<void> {
  const { loadEnv, isZepCloudConfigured } = await import('../../shared/utils/env');
  const { getCurrentGroupId, getGroupIds } = await import('../../shared/group-id');
  const { createLogger } = await import('../../shared/logger');
  const { popFlag, hasFlag } = await import('../../shared/utils/cli');
  const { createCache, createCacheConfig, nullCache } = await import('../../shared/utils/cache');
  const {
    createNeo4jClient, createNeo4jConfigFromEnv,
    createMcpClient, createMcpConfigFromEnv,
    createZepClient, createZepConfigFromEnv,
  } = await import('../../shared/clients');
  const { createTaskService, createTaskCliService } = await import('../../shared/services');

  const env = loadEnv();
  const logger = createLogger('tasks');
  const args = process.argv.slice(2);

  const command = args.shift() ?? '';
  const explicitGroup = popFlag(args, '--group', null);
  const limit = Number(popFlag(args, '--limit', '20')) || 20;
  const status = popFlag(args, '--status', 'todo');
  const tag = popFlag(args, '--tag', null);
  const repo = popFlag(args, '--repo', path.basename(process.cwd()) || 'unknown');
  const assignee = popFlag(args, '--assignee', process.env.USER || 'unknown') || 'unknown';
  const notes = popFlag(args, '--notes', '');
  const useCache = hasFlag(args, '--cache');
  const payload = args.join(' ').trim();

  const cache = useCache ? createCache(createCacheConfig(__dirname, 'tasks.log')) : nullCache;

  const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv(env.raw));
  const mcpClient = createMcpClient(createMcpConfigFromEnv(env.raw));
  const zepConfig = createZepConfigFromEnv(env.raw);
  const zepClient = isZepCloudConfigured(env) && zepConfig ? createZepClient(zepConfig) : null;

  const taskService = createTaskService({ neo4jClient, mcpClient, zepClient });
  const cliService = createTaskCliService({
    env, logger, cache, taskService, getGroupIds, getCurrentGroupId,
  });

  try {
    const result = await cliService.run({
      command, payload, explicitGroup, limit, status, tag, repo, assignee, notes,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Command failed: ${command}`, { error: message });
    const fallback = cache.readFallback();
    if (fallback) {
      console.log(JSON.stringify({ status: 'fallback', error: message, fallback }, null, 2));
      return;
    }
    console.error(message);
    process.exit(1);
  }
}

main();
