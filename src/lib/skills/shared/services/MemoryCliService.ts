/**
 * Memory CLI service - encapsulates all memory CLI command logic.
 */
import type { IEnvConfig } from '../utils/env';
import type { ILogger } from '../utils/interfaces/ILogger';
import type { ICache } from '../utils/cache';
import type {
  IMemoryService,
  IMemoryLoadResult,
  IMemoryAddResult,
  IMemoryLoadOptions,
} from './interfaces';
import { parseDate } from '../../../utils/dateParser';

/**
 * Parsed memory CLI arguments.
 */
export interface IMemoryCliArgs {
  command: string;
  payload: string;
  explicitGroup: string | null;
  query: string;
  limit: number;
  explicitTag: string | null;
  entityType: string | null;
  source: string;
  since: string | null;
  until: string | null;
}

/**
 * Dependencies for MemoryCliService.
 */
export interface IMemoryCliDependencies {
  env: IEnvConfig;
  logger: ILogger;
  cache: ICache;
  memoryService: IMemoryService;
  getGroupIds: () => string[];
  getCurrentGroupId: () => string;
  resolveTag: (text: string, explicitTag: string | null, entityType: string | null) => string | undefined;
}

/**
 * Memory CLI service interface.
 */
export interface IMemoryCliService {
  run(args: IMemoryCliArgs): Promise<IMemoryLoadResult | IMemoryAddResult>;
}

/**
 * Creates a memory CLI service instance.
 */
export function createMemoryCliService(deps: IMemoryCliDependencies): IMemoryCliService {
  const { env, logger, cache, memoryService, getGroupIds, getCurrentGroupId, resolveTag } = deps;

  return {
    async run(args: IMemoryCliArgs): Promise<IMemoryLoadResult | IMemoryAddResult> {
      const { command, payload, explicitGroup, query, limit, explicitTag, entityType, source, since, until } = args;

      if (!['add', 'load'].includes(command)) {
        throw new Error('command must be add|load');
      }

      // Use explicit --group if provided, otherwise use canonical folder-based group ID
      const groupId = explicitGroup || getCurrentGroupId();

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });

      let result: IMemoryLoadResult | IMemoryAddResult;

      if (command === 'load') {
        // Always use canonical group IDs for loading (hierarchical lookup)
        const groupIds = explicitGroup ? [explicitGroup] : getGroupIds();
        logger.debug('Using Neo4j direct mode for load');
        
        // Parse date filters - throw error on invalid values
        const loadOptions: IMemoryLoadOptions = {};
        if (since) {
          const parsedSince = parseDate(since);
          if (!parsedSince) {
            throw new Error(`Invalid --since date: "${since}". Use formats like: today, yesterday, 7d, 1w, 1m, or ISO date (2026-01-27)`);
          }
          loadOptions.since = parsedSince;
        }
        if (until) {
          const parsedUntil = parseDate(until);
          if (!parsedUntil) {
            throw new Error(`Invalid --until date: "${until}". Use formats like: today, yesterday, 7d, 1w, 1m, or ISO date (2026-01-27)`);
          }
          loadOptions.until = parsedUntil;
        }
        
        result = await memoryService.load(groupIds, query, limit, loadOptions);
      } else {
        if (!payload) throw new Error('add requires text payload');
        const tag = resolveTag(payload, explicitTag, entityType);
        result = await memoryService.add(payload, groupId, { tag, type: entityType ?? undefined, source });
      }

      const factsCount = 'facts' in result ? result.facts?.length ?? 0 : 0;
      logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, factsCount });

      cache.write(result as unknown as Record<string, unknown>);

      return result;
    },
  };
}
