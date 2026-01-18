/**
 * Shared utility implementations and interfaces.
 */

// Re-export interfaces
export * from './interfaces';

// Export utility factories and functions
export { createFileCache, createCacheConfigFromSkill } from './FileCache';
export { createLogger, createConsoleLogger, logger } from './Logger';
export {
  loadEnv,
  isZepCloudConfigured,
  isNeo4jConfigured,
  isLocalMcpConfigured,
  type IEnvConfig,
} from './env';
export {
  getCurrentGroupId,
  getGroupIds,
  getHierarchicalGroupIds,
  normalizeGroupId,
  createZepUserId,
  createZepThreadId,
} from './group-id';

// CLI argument parsing
export {
  popFlag,
  hasFlag,
  parseArgs,
  getFlag,
  hasArgFlag,
  type IParsedArgs,
} from './cli';

// Cache utilities
export {
  createCache,
  createCacheConfig,
  nullCache,
  type ICache,
  type ICacheConfig,
} from './cache';
