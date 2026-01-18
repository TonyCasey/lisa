/**
 * File-based cache implementation.
 * Supports both overwrite and append (log-style) modes.
 */
import type { ICache, ICacheConfig } from './interfaces';
import fs from 'fs';
import path from 'path';

/**
 * Creates a file-based cache instance.
 */
export function createFileCache(config: ICacheConfig): ICache {
  const cacheDir = config.cacheDir;
  const appendMode = config.appendMode ?? true;

  /**
   * Ensure the cache directory exists.
   */
  function ensureDir(): void {
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    } catch (_err) {
      // Silently fail if we can't create the directory
    }
  }

  return {
    write(key: string, data: unknown): void {
      try {
        ensureDir();
        const filePath = path.join(cacheDir, `${key}.log`);
        const line = JSON.stringify({
          ts: new Date().toISOString(),
          ...((data as Record<string, unknown>) || {}),
        });

        if (appendMode) {
          fs.appendFileSync(filePath, `${line}\n`, 'utf8');
        } else {
          fs.writeFileSync(filePath, `${line}\n`, 'utf8');
        }
      } catch (_err) {
        // Cache failures should not crash the application
      }
    },

    read(key: string): unknown | null {
      try {
        const filePath = path.join(cacheDir, `${key}.log`);
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) return null;

        // Parse all lines and return as array
        const lines = content.split('\n').filter(Boolean);
        return lines.map((l) => JSON.parse(l));
      } catch (_err) {
        return null;
      }
    },

    readLatest(key: string): unknown | null {
      try {
        const filePath = path.join(cacheDir, `${key}.log`);
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) return null;

        // Parse the last line only
        const lines = content.split('\n').filter(Boolean);
        if (lines.length === 0) return null;

        return JSON.parse(lines[lines.length - 1]);
      } catch (_err) {
        return null;
      }
    },

    getFilePath(key: string): string {
      return path.join(cacheDir, `${key}.log`);
    },

    clear(key: string): void {
      try {
        const filePath = path.join(cacheDir, `${key}.log`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_err) {
        // Silently fail
      }
    },
  };
}

/**
 * Creates a cache config for the default .lisa cache directory.
 * @param skillName - Name of the skill (e.g., 'memory', 'tasks')
 */
export function createCacheConfigFromSkill(skillName: string): ICacheConfig {
  // Determine .lisa directory by traversing up from current file
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    const baseName = path.basename(dir);

    if (baseName === '.lisa') {
      return {
        cacheDir: path.join(dir, 'skills', skillName, 'cache'),
        appendMode: true,
      };
    }

    dir = parent;
  }

  // Fallback: assume .lisa is at project root
  return {
    cacheDir: path.join(process.cwd(), '.lisa', 'skills', skillName, 'cache'),
    appendMode: true,
  };
}
