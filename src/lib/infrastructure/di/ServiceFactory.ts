/**
 * Service Configuration
 *
 * Configuration types for the DI container bootstrap.
 * The actual composition root is bootstrapContainer() in bootstrap.ts.
 */

import type { ILogger } from '../../domain/interfaces';
import type { IRepositoryFactoryConfig } from '../dal';

/**
 * Configuration for creating Lisa services via the DI container.
 *
 * Pass to bootstrapContainer() to configure the composition root.
 */
export interface IServiceConfig {
  /** Project root directory (defaults to cwd) */
  projectRoot?: string;

  /** Git worktree path (for multi-worktree setups) */
  gitWorktree?: string;

  /** MCP endpoint URL */
  mcpEndpoint?: string;

  /** API key for Zep Cloud (if using) */
  apiKey?: string;

  /** Source CLI adapter ('claude-code' | 'opencode') */
  source?: 'claude-code' | 'opencode';

  /** Enable DAL router for multi-backend support (default: true) */
  enableRouter?: boolean;

  /** DAL router configuration overrides */
  dalConfig?: IRepositoryFactoryConfig;

  /** Custom logger instance (uses default if not provided) */
  logger?: ILogger;

  /** Disable logging entirely (for testing) */
  disableLogging?: boolean;

  /** Use async (non-blocking) file writes for logging - ideal for hooks */
  asyncLogging?: boolean;

  /** Enable GitHub sync service for task synchronization (default: true if gh CLI available) */
  enableGitHubSync?: boolean;
}
