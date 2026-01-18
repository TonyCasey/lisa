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
} from './interfaces';

/**
 * Parsed memory CLI arguments.
 */
export interface IMemoryCliArgs {
  command: string;
  payload: string;
  explicitGroup: string | null;
  hasConfiguredGroup: boolean;
  query: string;
  limit: number;
  explicitTag: string | null;
  entityType: string | null;
  source: string;
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
      const { command, payload, explicitGroup, hasConfiguredGroup, query, limit, explicitTag, entityType, source } = args;

      if (!['add', 'load'].includes(command)) {
        throw new Error('command must be add|load');
      }

      const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });

      let result: IMemoryLoadResult | IMemoryAddResult;

      if (command === 'load') {
        const groupIds = hasConfiguredGroup ? [groupId] : getGroupIds();
        logger.debug('Using Neo4j direct mode for load');
        result = await memoryService.load(groupIds, query, limit);
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
