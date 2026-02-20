/**
 * Task CLI service - encapsulates all task CLI command logic.
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */
import type { IEnvConfig } from '../utils/env';
import type { ILogger } from '../utils/interfaces/ILogger';
import type { ICache } from '../utils/cache';
import type {
  ITaskService,
  ITaskListResult,
  ITaskWriteResult,
  ITaskLinkResult,
  ITaskExternalLink,
  ExternalLinkSource,
  ITaskLoadOptions,
} from './interfaces';
import { parseDate } from '../../../utils/dateParser';

/**
 * Parsed task CLI arguments.
 */
export interface ITaskCliArgs {
  command: string;
  payload: string;
  limit: number;
  status: string;
  tag: string | null;
  repo: string;
  assignee: string;
  notes: string;
  link?: string | null;        // External link reference (e.g., "github#123", "jira#PROJ-456")
  linkedSource?: string | null; // Filter by external link source for listLinked
  since: string | null;
  until: string | null;
  all?: boolean;
}

/**
 * Dependencies for TaskCliService.
 */
export interface ITaskCliDependencies {
  env: IEnvConfig;
  logger: ILogger;
  cache: ICache;
  taskService: ITaskService;
}

/**
 * Task CLI service interface.
 */
export interface ITaskCliService {
  run(args: ITaskCliArgs): Promise<ITaskListResult | ITaskWriteResult | ITaskLinkResult>;
}

/**
 * Parse an external link reference string (e.g., "github#123", "jira#PROJ-456").
 * Returns null if invalid format.
 */
function parseExternalLinkRef(ref: string): ITaskExternalLink | null {
  // Format: source#id (e.g., github#123, jira#PROJ-456)
  const match = ref.match(/^(github|jira|linear)#(.+)$/i);
  if (!match) {
    return null;
  }
  
  const source = match[1].toLowerCase() as ExternalLinkSource;
  const id = match[2];
  
  // Build URL based on source
  let url: string;
  switch (source) {
    case 'github':
      // For GitHub, we can't determine the full URL without repo context
      // Just store a placeholder that can be resolved later
      url = `https://github.com/OWNER/REPO/issues/${id}`;
      break;
    case 'jira':
      // For Jira, we can't determine the full URL without endpoint
      url = `https://COMPANY.atlassian.net/browse/${id}`;
      break;
    case 'linear':
      url = `https://linear.app/issue/${id}`;
      break;
    default:
      return null;
  }
  
  return { source, id, url };
}

/**
 * Creates a task CLI service instance.
 */
export function createTaskCliService(deps: ITaskCliDependencies): ITaskCliService {
  const { env, logger, cache, taskService } = deps;

  return {
    async run(args: ITaskCliArgs): Promise<ITaskListResult | ITaskWriteResult | ITaskLinkResult> {
      const { command, payload, limit, status, tag, repo, assignee, notes, link, linkedSource, since, until, all } = args;

      const validCommands = ['add', 'list', 'update', 'link', 'unlink', 'list-linked'];
      if (!validCommands.includes(command)) {
        throw new Error(`command must be ${validCommands.join('|')}`);
      }

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE });

      let result: ITaskListResult | ITaskWriteResult | ITaskLinkResult;

      if (command === 'list') {
        logger.debug('Using git-mem mode for list');

        // Parse date filters - throw error on invalid values
        const loadOptions: ITaskLoadOptions = {};
        let effectiveSince = since;
        if (!effectiveSince && !until && !all) {
          effectiveSince = 'today';
        }
        if (effectiveSince) {
          const parsedSince = parseDate(effectiveSince);
          if (!parsedSince) {
            throw new Error(`Invalid --since date: "${effectiveSince}". Use formats like: today, yesterday, 7d, 1w, 1m, or ISO date (2026-01-27)`);
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

        result = await taskService.list(limit, repo, assignee, loadOptions);
      } else if (command === 'list-linked') {
        // List tasks with external links
        const source = linkedSource as ExternalLinkSource | undefined;
        logger.debug('Listing linked tasks', { source });
        result = await taskService.listLinked(source, limit, repo, assignee);
      } else if (command === 'add') {
        if (!payload) throw new Error('add requires task text (title)');

        // Parse external link if provided
        let externalLink: ITaskExternalLink | undefined;
        if (link) {
          const parsed = parseExternalLinkRef(link);
          if (!parsed) {
            throw new Error(`Invalid link format: ${link}. Expected: github#123, jira#PROJ-456, or linear#ABC-123`);
          }
          externalLink = { ...parsed, syncedAt: new Date().toISOString() };
        }

        result = await taskService.add(payload, { status, repo, assignee, notes, tag, externalLink });
      } else if (command === 'update') {
        if (!payload) throw new Error('update requires task text (title)');

        // Parse external link if provided (null means unlink)
        let externalLink: ITaskExternalLink | null | undefined;
        if (link === '') {
          // Empty string means unlink
          externalLink = null;
        } else if (link) {
          const parsed = parseExternalLinkRef(link);
          if (!parsed) {
            throw new Error(`Invalid link format: ${link}. Expected: github#123, jira#PROJ-456, or linear#ABC-123`);
          }
          externalLink = { ...parsed, syncedAt: new Date().toISOString() };
        }

        result = await taskService.update(payload, { status, repo, assignee, notes, tag, externalLink });
      } else if (command === 'link') {
        // Link command: payload is UUID, link is the reference
        if (!payload) throw new Error('link requires task UUID');
        if (!link) throw new Error('link requires --link github#123 or similar');

        const parsed = parseExternalLinkRef(link);
        if (!parsed) {
          throw new Error(`Invalid link format: ${link}. Expected: github#123, jira#PROJ-456, or linear#ABC-123`);
        }
        const externalLink = { ...parsed, syncedAt: new Date().toISOString() };

        result = await taskService.link(payload, externalLink);
      } else if (command === 'unlink') {
        // Unlink command: payload is UUID
        if (!payload) throw new Error('unlink requires task UUID');

        result = await taskService.unlink(payload);
      } else {
        throw new Error(`Unknown command: ${command}`);
      }

      const tasksCount = 'tasks' in result ? result.tasks?.length ?? 0 : 0;
      logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, tasksCount });

      cache.write(result as unknown as Record<string, unknown>);

      return result;
    },
  };
}
