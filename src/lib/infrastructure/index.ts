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

// MCP client
export * from './mcp';

// Service implementations
export * from './services';

// Dependency injection
export * from './di';

// Data Access Layer (DAL) for multi-backend support
export * from './dal';

// Logging infrastructure
export * from './logging';

// Note: CLI adapters (./adapters/claude/, ./adapters/opencode/)
// are entry points, not exported from here.
