/**
 * Client implementations and interfaces for backend connections.
 *
 * The git-mem factory is now consolidated in infrastructure.
 * This file re-exports it for backwards compatibility.
 */

// Re-export interfaces
export * from './interfaces';

// Export client factories
// createGitMem is re-exported from infrastructure for backwards compatibility
export { createGitMem } from '../../../infrastructure/git-mem';
export { createGhCliClient, createGhCliClientFromEnv } from './GhCliClient';
