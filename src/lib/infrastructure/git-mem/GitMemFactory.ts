/**
 * Shared git-mem factory with lazy singleton pattern.
 *
 * Provides a single git-mem instance that can be used by both:
 * - Infrastructure DI (bootstrap.ts)
 * - Skills entry points (memory.ts, tasks.ts, etc.)
 *
 * This consolidates the duplicate factory patterns from:
 * - skills/shared/clients/GitMemFactory.ts
 * - bootstrap.ts inline creation
 */

import { MemoryService, NotesService, MemoryRepository } from 'git-mem/dist/index';
import type { IMemoryService as IGitMemMemoryService } from 'git-mem/dist/index';

/** Lazy singleton instance */
let gitMemInstance: IGitMemMemoryService | null = null;

/**
 * Get or create the shared git-mem MemoryService instance.
 *
 * Uses lazy initialization - the instance is created on first call
 * and reused for subsequent calls within the same process.
 *
 * @returns The git-mem MemoryService instance
 */
export function getGitMemInstance(): IGitMemMemoryService {
  if (!gitMemInstance) {
    const notes = new NotesService();
    const repo = new MemoryRepository(notes);
    gitMemInstance = new MemoryService(repo);
  }
  return gitMemInstance;
}

/**
 * Create a fresh git-mem MemoryService instance.
 *
 * Use this when you need an isolated instance (e.g., for testing)
 * rather than the shared singleton.
 *
 * @returns A new git-mem MemoryService instance
 */
export function createGitMem(): IGitMemMemoryService {
  const notes = new NotesService();
  const repo = new MemoryRepository(notes);
  return new MemoryService(repo);
}

/**
 * Reset the singleton instance (for testing only).
 * @internal
 */
export function resetGitMemInstance(): void {
  gitMemInstance = null;
}
