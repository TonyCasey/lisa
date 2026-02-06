/**
 * Client implementations and interfaces for backend connections.
 */

// Re-export interfaces
export * from './interfaces';

// Export client factories
export { createGitMem } from './GitMemFactory';
export { createNeo4jClient, createNeo4jConfigFromEnv } from './Neo4jClient';
export { createMcpClient, createMcpConfigFromEnv } from './McpClient';
export { createZepClient, createZepConfigFromEnv } from './ZepClient';
export { createGhCliClient, createGhCliClientFromEnv } from './GhCliClient';
