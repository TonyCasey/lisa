/**
 * Shared modules for Lisa skills.
 * 
 * This module provides common clients and utilities used by all skills:
 * - Client interfaces and implementations for Neo4j, MCP, and Zep
 * - Utility functions for caching, logging, environment, and group IDs
 * 
 * Usage:
 *   import { createMcpClient, createLogger, loadEnv, getCurrentGroupId } from '../shared';
 */

// Re-export everything from clients
export * from './clients';

// Re-export everything from utils
export * from './utils';
