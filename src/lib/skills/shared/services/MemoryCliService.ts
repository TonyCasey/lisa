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
  IMemoryConflictsResult,
  IMemoryDedupeResult,
  IMemoryCurateResult,
  IMemoryConsolidateResult,
  IMemoryLoadOptions,
} from './interfaces';
import { parseDate } from '../../../utils/dateParser';
import type { CurationMark } from '../../../domain/interfaces/ICurationService';
import type { ConsolidationAction } from '../../../domain/interfaces/IConsolidationService';

/** CLI result union for all memory commands. */
export type MemoryCliResult = IMemoryLoadResult | IMemoryAddResult | IMemoryExpireResult | IMemoryCleanupResult | IMemoryConflictsResult | IMemoryDedupeResult | IMemoryCurateResult | IMemoryConsolidateResult;

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
  topic: string | null;
  minSimilarity: number | null;
  mark: string | null;
  action: string | null;
  retain: string | null;
  mergedText: string | null;
}

/**
 * Dependencies for MemoryCliService.
 */
export interface IMemoryCliDependencies {
  env: IEnvConfig;
  logger: ILogger;
  cache: ICache;
  memoryService: IMemoryService;
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
  const { env, logger, cache, memoryService, resolveTag } = deps;

  return {
    async run(args: IMemoryCliArgs): Promise<MemoryCliResult> {
      const {
        command, payload, query, limit,
        explicitTag, entityType, source, since, until,
        lifecycle, ttl, dryRun, uuid, topic, minSimilarity,
        mark, action, retain, mergedText,
      } = args;

      if (!['add', 'load', 'expire', 'cleanup', 'conflicts', 'dedupe', 'curate', 'consolidate'].includes(command)) {
        throw new Error('command must be add|load|expire|cleanup|conflicts|dedupe|curate|consolidate');
      }

      logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE });

      let result: MemoryCliResult;

      if (command === 'load') {
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

        result = await memoryService.load(query, limit, loadOptions);
      } else if (command === 'expire') {
        const targetUuid = uuid || payload;
        if (!targetUuid) throw new Error('expire requires a UUID (--uuid <id> or positional argument)');
        result = await memoryService.expire(targetUuid);
      } else if (command === 'cleanup') {
        result = await memoryService.cleanup(dryRun);
      } else if (command === 'conflicts') {
        result = await memoryService.conflicts(topic ?? undefined);
      } else if (command === 'dedupe') {
        const dedupeOptions: { minSimilarity?: number; limit?: number; since?: Date } = {};
        if (minSimilarity !== null) dedupeOptions.minSimilarity = minSimilarity;
        if (limit) dedupeOptions.limit = limit;
        if (since) {
          const parsedSince = parseDate(since);
          if (!parsedSince) {
            throw new Error(`Invalid --since date: "${since}". Use formats like: today, yesterday, 7d, 1w, 1m, or ISO date (2026-01-27)`);
          }
          dedupeOptions.since = parsedSince;
        }
        result = await memoryService.dedupe(dedupeOptions);
      } else if (command === 'curate') {
        const targetUuid = uuid || payload;
        if (!targetUuid) throw new Error('curate requires a UUID (--uuid <id> or positional argument)');
        if (!mark) throw new Error('curate requires --mark (authoritative, draft, deprecated, needs-review)');
        result = await memoryService.curate(targetUuid, mark as CurationMark);
      } else if (command === 'consolidate') {
        // Parse UUIDs from payload (space-separated)
        const factUuids = payload ? payload.split(/\s+/).filter(Boolean) : [];
        if (factUuids.length < 2) throw new Error('consolidate requires at least 2 fact UUIDs');
        const consolidateAction = (action || 'archive-duplicates') as ConsolidationAction;
        const consolidateOptions: { retainUuid?: string; mergedText?: string } = {};
        if (retain) consolidateOptions.retainUuid = retain;
        if (mergedText) consolidateOptions.mergedText = mergedText;
        result = await memoryService.consolidate(factUuids, consolidateAction, consolidateOptions);
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

        result = await memoryService.add(payload, {
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
