/**
 * DAL Query Types
 *
 * Core types for the Data Access Layer query system.
 */

import { IMemoryItem } from '../types/IMemoryResult';
import { ITask } from '../types/ITask';

/**
 * Fields that can be used for sorting.
 */
export type SortField = 'created_at' | 'valid_at' | 'name' | 'relevance';

/**
 * Sort order direction.
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Sort configuration.
 */
export interface ISortOption {
  readonly field: SortField;
  readonly order: SortOrder;
}

/**
 * Options for querying repositories.
 */
export interface IQueryOptions {
  /** Semantic search query (optional) */
  readonly query?: string;
  /** Maximum number of results */
  readonly limit?: number;
  /** Pagination offset */
  readonly offset?: number;
  /** Sort configuration */
  readonly sort?: ISortOption;
  /** Filter by tags */
  readonly tags?: readonly string[];
  /** Filter by date: created on or after */
  readonly since?: Date;
  /** Filter by date: created on or before */
  readonly until?: Date;
  /** Include expired/invalidated facts */
  readonly includeExpired?: boolean;
}

/**
 * Backend source identifier.
 */
export type BackendSource = 'mcp' | 'neo4j' | 'zep';

/**
 * Result from a repository query.
 */
export interface IQueryResult<T> {
  /** The items returned */
  readonly items: readonly T[];
  /** Total count if available (for pagination) */
  readonly total?: number;
  /** Whether more results are available */
  readonly hasMore?: boolean;
  /** Which backend served this result */
  readonly source: BackendSource;
}

/**
 * Memory query result type alias.
 */
export type IMemoryQueryResult = IQueryResult<IMemoryItem>;

/**
 * Task query result type alias.
 */
export type ITaskQueryResult = IQueryResult<ITask>;

/**
 * Operation types for routing decisions.
 */
export type OperationType =
  | 'list'      // Date-ordered listing (prefers Neo4j)
  | 'search'    // Semantic search (prefers MCP)
  | 'write'     // Write operations (prefers MCP for ingestion)
  | 'aggregate'; // Counts, stats (prefers Neo4j)

/**
 * Default query options.
 */
export const DEFAULT_QUERY_OPTIONS: Required<
  Pick<IQueryOptions, 'limit' | 'offset' | 'sort' | 'includeExpired'>
> = {
  limit: 10,
  offset: 0,
  sort: { field: 'created_at', order: 'desc' },
  includeExpired: false,
};

/**
 * Apply defaults to query options.
 */
export function applyQueryDefaults(options?: IQueryOptions): IQueryOptions {
  return {
    ...DEFAULT_QUERY_OPTIONS,
    ...options,
  };
}
