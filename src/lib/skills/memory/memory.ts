#!/usr/bin/env node
/**
 * Memory management CLI - thin entry point.
 *
 * Commands:
 *   node memory.js add "text" [--group <id>] [--tag foo] [--type <type>] [--source <src>] [--lifecycle <tier>] [--ttl <dur>] [--cache]
 *   node memory.js load [--group <id>] [--query <q>] [--limit N] [--since <d>] [--until <d>] [--cache]
 *   node memory.js expire [--uuid <uuid>] [--group <id>] [--cache]   (uuid can also be positional)
 *   node memory.js cleanup [--group <id>] [--dry-run] [--cache]
 *   node memory.js conflicts [--group <id>] [--topic <tag>] [--cache]
 *   node memory.js dedupe [--group <id>] [--min-similarity <n>] [--limit N] [--since <d>] [--cache]
 *   node memory.js curate [--uuid <uuid>] [--group <id>] [--mark <mark>] [--cache]
 *   node memory.js consolidate <uuid1> <uuid2> [...] [--group <id>] [--action <action>] [--retain <uuid>] [--text <text>] [--cache]
 */

export {};

async function main(): Promise<void> {
  const { loadEnv } = await import('../shared/utils/env');
  const { createLogger } = await import('../shared/logger');
  const { popFlag, hasFlag } = await import('../shared/utils/cli');
  const { createCache, createCacheConfig, nullCache } = await import('../shared/utils/cache');
  const { resolveTag } = await import('../common/type-mappings');
  const { createGitMem } = await import('../shared/clients');
  const { createMemoryService, createMemoryCliService } = await import('../shared/services');

  const env = loadEnv();
  const logger = createLogger('memory');
  const args = process.argv.slice(2);

  const command = args.shift() ?? '';
  const explicitGroup = popFlag(args, '--group', null);
  const query = popFlag(args, '--query', '');
  const limit = Number(popFlag(args, '--limit', '10')) || 10;
  const explicitTag = popFlag(args, '--tag', null);
  const entityType = popFlag(args, '--type', null);
  const source = popFlag(args, '--source', 'skill:load-memory');
  const since = popFlag(args, '--since', null);
  const until = popFlag(args, '--until', null);
  const lifecycle = popFlag(args, '--lifecycle', null);
  const ttl = popFlag(args, '--ttl', null);
  const uuid = popFlag(args, '--uuid', null);
  const topic = popFlag(args, '--topic', null);
  const minSimilarityRaw = popFlag(args, '--min-similarity', null);
  const minSimilarity = minSimilarityRaw !== null
    ? (() => {
        const parsed = Number(minSimilarityRaw);
        return Number.isNaN(parsed) ? null : parsed;
      })()
    : null;
  const mark = popFlag(args, '--mark', null);
  const action = popFlag(args, '--action', null);
  const retain = popFlag(args, '--retain', null);
  const mergedText = popFlag(args, '--text', null);
  const dryRun = hasFlag(args, '--dry-run');
  const useCache = hasFlag(args, '--cache');
  const payload = args.join(' ').trim();

  const cache = useCache ? createCache(createCacheConfig(__dirname, 'memory.log')) : nullCache;

  const gitMem = createGitMem();
  const memoryService = createMemoryService({ gitMem });
  const cliService = createMemoryCliService({
    env, logger, cache, memoryService, resolveTag,
  });

  try {
    const result = await cliService.run({
      command, payload, explicitGroup, query, limit, explicitTag,
      entityType, source, since, until, lifecycle, ttl, dryRun, uuid, topic, minSimilarity,
      mark, action, retain, mergedText,
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
