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
  IMemoryExpireResult,
  IMemoryCleanupResult,
  IMemoryLoadOptions,
  IMemoryLinkResult,
  IMemoryLinksResult,
  IMemoryCompactResult,
} from './interfaces';
import { isValidRelationType } from '../../../domain/interfaces/types/IMemoryRelationship';
import { parseDate } from '../../../utils/dateParser';

/** CLI result union for all memory commands. */
export type MemoryCliResult = IMemoryLoadResult | IMemoryAddResult | IMemoryExpireResult | IMemoryCleanupResult | IMemoryLinkResult | IMemoryLinksResult | IMemoryCompactResult;

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
  lifecycle: string | null;
  ttl: string | null;
  dryRun: boolean;
  uuid: string | null;
  note: string | null;
  before: string | null;
  minGroup: number;
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
  run(args: IMemoryCliArgs): Promise<MemoryCliResult>;
}

/**
 * Parse a human-readable TTL duration string into milliseconds.
 *
 * Supported formats:
 *   - `30s` / `30sec` → 30 seconds
 *   - `5m` / `5min` → 5 minutes
 *   - `2h` / `2hr` → 2 hours
 *   - `7d` → 7 days
 *   - `1w` → 1 week
 *   - Plain number → treated as milliseconds
 *
 * @returns milliseconds, or null if the string is not a valid duration
 */
export function parseTtlDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Plain number → milliseconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|w)$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1_000,
    sec: 1_000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) return null;

  return Math.round(value * multiplier);
}

/**
 * Creates a memory CLI service instance.
 */
export function createMemoryCliService(deps: IMemoryCliDependencies): IMemoryCliService {
  const { env, logger, cache, memoryService, getGroupIds, getCurrentGroupId, resolveTag } = deps;

  return {
    async run(args: IMemoryCliArgs): Promise<MemoryCliResult> {
      const {
        command, payload, explicitGroup, query, limit,
        explicitTag, entityType, source, since, until,
        lifecycle, ttl, dryRun, uuid, note, before, minGroup,
      } = args;

      if (!['add', 'load', 'expire', 'cleanup', 'link', 'links', 'compact'].includes(command)) {
        throw new Error('command must be add|load|expire|cleanup|link|links|compact');
      }

      // Use explicit --group if provided, otherwise use canonical folder-based group ID
      const groupId = explicitGroup || getCurrentGroupId();

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });

      let result: MemoryCliResult;

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
      } else if (command === 'expire') {
        const targetUuid = uuid || payload;
        if (!targetUuid) throw new Error('expire requires a UUID (--uuid <id> or positional argument)');
        result = await memoryService.expire(groupId, targetUuid);
      } else if (command === 'cleanup') {
        result = await memoryService.cleanup(groupId, dryRun);
      } else if (command === 'link') {
        // payload = "sourceUuid targetUuid"
        const parts = payload.split(/\s+/).filter(Boolean);
        const sourceUuid = parts[0];
        const targetUuid = parts[1];
        if (!sourceUuid || !targetUuid) {
          throw new Error('link requires two UUIDs: lisa memory link <sourceUuid> <targetUuid>');
        }
        const relationType = entityType || 'relates_to';
        if (!isValidRelationType(relationType)) {
          throw new Error(`Invalid relation type: "${relationType}". Valid types: supersedes, supports, contradicts, implements, relates_to, refines`);
        }
        result = await memoryService.linkFacts(groupId, sourceUuid, targetUuid, relationType, note ?? undefined);
      } else if (command === 'links') {
        const targetUuid = uuid || payload;
        if (!targetUuid) {
          throw new Error('links requires a UUID: lisa memory links <uuid>');
        }
        const relationType = entityType || undefined;
        if (relationType && !isValidRelationType(relationType)) {
          throw new Error(`Invalid relation type: "${relationType}". Valid types: supersedes, supports, contradicts, implements, relates_to, refines`);
        }
        result = await memoryService.getRelatedFacts(groupId, targetUuid, relationType);
      } else if (command === 'compact') {
        if (!before) {
          throw new Error('compact requires --before <date>: lisa memory compact --before 30d');
        }
        const parsedBefore = parseDate(before);
        if (!parsedBefore) {
          throw new Error(`Invalid --before date: "${before}". Use formats like: 30d, 3m, 1y, or ISO date (2026-01-01)`);
        }
        result = await memoryService.compact(groupId, {
          olderThan: parsedBefore,
          dryRun,
          minGroupSize: minGroup,
        });
      } else {
        // add
        if (!payload) throw new Error('add requires text payload');

        // Resolve tag: explicit --tag > --type > --lifecycle > text prefix
        const tag = resolveTag(
          payload,
          explicitTag,
          entityType ?? (lifecycle && !explicitTag ? lifecycle : null)
        );

        // Parse and validate --ttl if provided
        let ttlMs: number | undefined;
        if (ttl) {
          const parsed = parseTtlDuration(ttl);
          if (parsed === null) {
            throw new Error(`Invalid --ttl duration: "${ttl}". Use formats like: 30s, 5m, 2h, 7d, 1w`);
          }
          ttlMs = parsed;
        }

        result = await memoryService.add(payload, groupId, {
          tag,
          type: entityType ?? lifecycle ?? undefined,
          source,
          ttl: ttlMs,
        });
      }

      const factsCount = 'facts' in result ? result.facts?.length ?? 0 : 0;
      logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, factsCount });

      cache.write(result as unknown as Record<string, unknown>);

      return result;
    },
  };
}
