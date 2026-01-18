/**
 * File-based cache utilities for skill scripts.
 * Provides simple write-ahead logging for fallback on errors.
 */
import fs from 'fs';
import path from 'path';

/**
 * Cache interface for skill scripts.
 */
export interface ICache {
  /**
   * Write a result to cache.
   * @param data - Data to cache
   */
  write(data: Record<string, unknown>): void;

  /**
   * Read the last cached entry as fallback.
   * @returns Last cached entry or null if not available
   */
  readFallback(): Record<string, unknown> | null;
}

/**
 * Configuration for creating a cache instance.
 */
export interface ICacheConfig {
  /** Directory containing the cache file */
  cacheDir: string;
  /** Cache filename (e.g., 'tasks.log', 'memory.log') */
  filename: string;
}

/**
 * Creates a file-based cache instance.
 *
 * @param config - Cache configuration
 * @returns Cache instance
 */
export function createCache(config: ICacheConfig): ICache {
  const cacheFile = path.join(config.cacheDir, config.filename);

  return {
    write(data: Record<string, unknown>): void {
      try {
        // Ensure cache directory exists
        const dir = path.dirname(cacheFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const line = JSON.stringify({ ts: new Date().toISOString(), ...data });
        fs.appendFileSync(cacheFile, `${line}\n`, 'utf8');
      } catch {
        // Ignore cache write errors - cache is optional
      }
    },

    readFallback(): Record<string, unknown> | null {
      try {
        const data = fs.readFileSync(cacheFile, 'utf8').trim().split('\n').filter(Boolean);
        if (!data.length) return null;
        return JSON.parse(data[data.length - 1]) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Creates a cache config for a skill script.
 * Cache files are stored in the skill's cache/ directory.
 *
 * @param scriptDir - __dirname of the script (e.g., tasks/scripts/)
 * @param filename - Cache filename (e.g., 'tasks.log')
 * @returns Cache configuration
 */
export function createCacheConfig(scriptDir: string, filename: string): ICacheConfig {
  return {
    cacheDir: path.join(scriptDir, '..', 'cache'),
    filename,
  };
}

/**
 * No-op cache implementation for when caching is disabled.
 */
export const nullCache: ICache = {
  write(): void {
    // No-op
  },
  readFallback(): null {
    return null;
  },
};
