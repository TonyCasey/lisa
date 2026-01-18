#!/usr/bin/env node
/**
 * Storage Mode CLI - thin entry point.
 *
 * Commands:
 *   node storage.js status [--cache]         Show current storage mode
 *   node storage.js switch <mode> [--cache]  Switch to local or zep-cloud
 */

export {};

import path from 'path';

async function main(): Promise<void> {
  const { createStorageService } = await import('../../shared/services');
  const { createLogger } = await import('../../shared/logger');
  const { createCache, createCacheConfig, nullCache } = await import('../../shared/utils/cache');
  const { hasFlag } = await import('../../shared/utils/cli');

  const log = createLogger('storage');
  const args = process.argv.slice(2);

  const command = args.shift() ?? '';
  const useCache = hasFlag(args, '--cache');
  const targetMode = args.shift() ?? '';

  const cache = useCache ? createCache(createCacheConfig(__dirname, 'storage.log')) : nullCache;
  const envPath = path.join(__dirname, '..', '..', '.env');
  const service = createStorageService({ envPath });

  try {
    if (!['status', 'switch'].includes(command)) {
      throw new Error('command must be status|switch');
    }

    log.info(`Executing command: ${command}`, { targetMode: targetMode || 'n/a' });

    let out;

    if (command === 'status') {
      out = await service.getStatus();
      log.debug('Status check completed', { mode: out.mode, isConnected: out.isConnected });
    } else {
      if (!targetMode) throw new Error('switch requires a mode (local or zep-cloud)');
      out = await service.switchMode(targetMode as 'local' | 'zep-cloud');
      log.info('Storage mode switched', { previousMode: out.previousMode, newMode: out.newMode });
    }

    if (out.status === 'ok') cache.write(out as unknown as Record<string, unknown>);
    console.log(JSON.stringify(out, null, 2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Command failed: ${command}`, { error: message });
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
