/**
 * Client implementations and interfaces for backend connections.
 */

// Re-export interfaces
export * from './interfaces';

// Export client factories
export { createGitMem } from './GitMemFactory';
export { createGhCliClient, createGhCliClientFromEnv } from './GhCliClient';
