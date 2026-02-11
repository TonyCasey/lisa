/**
 * Infrastructure Layer
 * 
 * Contains implementations of domain interfaces.
 * This layer depends on Domain and Application layers.
 * 
 * Layer Dependencies:
 *   Domain <- Application <- Infrastructure
 *   (Infrastructure implements Domain interfaces)
 */

// Context detection
export * from './context';

// Service implementations
export * from './services';

// Dependency injection
export * from './di';

// Data Access Layer (Neo4j PR state only)
export * from './dal';

// Logging infrastructure
export * from './logging';

// Utilities (cancellation, etc.)
export * from './utils';

// GitHub CLI wrapper
export * from './github';

// Notifications
export * from './notifications';

// Cron service for scheduled tasks
export * from './cron';

// Git CLI wrapper
export * from './git';

// Claude CLI wrapper
export * from './claude';

// Note: CLI adapters (./adapters/claude/, ./adapters/opencode/)
// are entry points, not exported from here.
