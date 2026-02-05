/**
 * NodeFileSystem
 *
 * Infrastructure implementation of IFileSystem using node:fs/promises.
 * Creates parent directories automatically when writing files.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IFileSystem } from '../../domain/interfaces/IFileSystem';

/**
 * Create a file system service backed by Node's fs/promises.
 */
export function createNodeFileSystem(): IFileSystem {
  return {
    async readFile(filePath: string): Promise<string> {
      return fsp.readFile(filePath, 'utf-8');
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, content, 'utf-8');
    },

    async stat(filePath: string): Promise<{ mtimeMs: number } | null> {
      try {
        const s = await fsp.stat(filePath);
        return { mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    },
  };
}
