/**
 * Shared modules for Lisa skills.
 *
 * This module provides common clients and utilities used by all skills:
 * - git-mem factory for memory operations
 * - GitHub CLI client
 * - Utility functions for caching, logging, environment, and group IDs
 *
 * Usage:
 *   import { createGitMem, createLogger, loadEnv, getCurrentGroupId } from '../shared';
 */

// Re-export everything from clients
export * from './clients';

// Re-export everything from utils
export * from './utils';
