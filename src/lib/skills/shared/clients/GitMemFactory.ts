/**
 * Factory for creating git-mem service instances in skill scripts.
 *
 * Centralises the git-mem wiring so every skill entry point
 * can call `createGitMem()` instead of repeating the setup.
 */
import { MemoryService, NotesService, MemoryRepository } from 'git-mem/dist/index';
import type { IMemoryService } from 'git-mem/dist/index';

/**
 * Create a git-mem MemoryService wired to the current repo's git notes.
 */
export function createGitMem(): IMemoryService {
  const notes = new NotesService();
  const repo = new MemoryRepository(notes);
  return new MemoryService(repo);
}
