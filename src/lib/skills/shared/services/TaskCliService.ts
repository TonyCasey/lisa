/**
 * Task CLI service - encapsulates all task CLI command logic.
 */
import type { IEnvConfig } from '../utils/env';
import type { ILogger } from '../utils/interfaces/ILogger';
import type { ICache } from '../utils/cache';
import type {
  ITaskService,
  ITaskListResult,
  ITaskWriteResult,
} from './interfaces';

/**
 * Parsed task CLI arguments.
 */
export interface ITaskCliArgs {
  command: string;
  payload: string;
  explicitGroup: string | null;
  limit: number;
  status: string;
  tag: string | null;
  repo: string;
  assignee: string;
  notes: string;
}

/**
 * Dependencies for TaskCliService.
 */
export interface ITaskCliDependencies {
  env: IEnvConfig;
  logger: ILogger;
  cache: ICache;
  taskService: ITaskService;
  getGroupIds: () => string[];
  getCurrentGroupId: () => string;
}

/**
 * Task CLI service interface.
 */
export interface ITaskCliService {
  run(args: ITaskCliArgs): Promise<ITaskListResult | ITaskWriteResult>;
}

/**
 * Creates a task CLI service instance.
 */
export function createTaskCliService(deps: ITaskCliDependencies): ITaskCliService {
  const { env, logger, cache, taskService, getGroupIds, getCurrentGroupId } = deps;

  return {
    async run(args: ITaskCliArgs): Promise<ITaskListResult | ITaskWriteResult> {
      const { command, payload, explicitGroup, limit, status, tag, repo, assignee, notes } = args;

      if (!['add', 'list', 'update'].includes(command)) {
        throw new Error('command must be add|list|update');
      }

      const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });

      let result: ITaskListResult | ITaskWriteResult;

      if (command === 'list') {
        const groupIds = explicitGroup ? [explicitGroup] : getGroupIds();
        logger.debug('Using Neo4j direct mode for list');
        result = await taskService.list(groupIds, limit, repo, assignee);
      } else if (command === 'add') {
        if (!payload) throw new Error('add requires task text (title)');
        result = await taskService.add(payload, groupId, { status, repo, assignee, notes, tag });
      } else {
        if (!payload) throw new Error('update requires task text (title)');
        result = await taskService.update(payload, groupId, { status, repo, assignee, notes, tag });
      }

      const tasksCount = 'tasks' in result ? result.tasks?.length ?? 0 : 0;
      logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, tasksCount });

      cache.write(result as unknown as Record<string, unknown>);

      return result;
    },
  };
}
