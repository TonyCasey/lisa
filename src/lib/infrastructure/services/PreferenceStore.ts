/**
 * Preference Store Implementation.
 *
 * File-based JSON storage of user preferences in `.lisa/preferences.json`.
 * Reads the full file on every operation (no in-memory cache — simple, correct).
 *
 * Part of Phase 5D: Preference Key-Value Store.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IPreferenceStore, IPreference } from '../../domain/interfaces/IPreferenceStore';

/**
 * Internal storage shape — map of key to value + updatedAt.
 */
interface IPreferenceEntry {
  value: string;
  updatedAt: string;
}

type PreferenceData = Record<string, IPreferenceEntry>;

const PREFERENCES_FILE = '.lisa/preferences.json';

/**
 * Create a file-based PreferenceStore.
 *
 * @param projectRoot - Project root directory (location of `.lisa/`)
 * @param logger - Optional logger for warnings (invalid JSON, etc.)
 */
export function createPreferenceStore(
  projectRoot: string,
  logger?: { warn: (msg: string, ctx?: Record<string, unknown>) => void }
): IPreferenceStore {
  const filePath = path.join(projectRoot, PREFERENCES_FILE);

  /**
   * Read the preferences file. Returns empty object on missing/invalid file.
   */
  async function readStore(): Promise<PreferenceData> {
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        logger?.warn('Invalid preferences.json structure, resetting to empty store', { filePath });
        await writeStore({});
        return {};
      }
      return parsed as PreferenceData;
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        logger?.warn('Invalid JSON in preferences.json, resetting to empty store', { filePath });
        await writeStore({});
        return {};
      }
      // ENOENT (file not found) — empty store, no error
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      // Other I/O errors (permissions, etc.) — surface them
      throw err;
    }
  }

  /**
   * Write the preferences file. Creates `.lisa/` directory if needed.
   */
  async function writeStore(data: PreferenceData): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
    }
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  return {
    async get(key: string): Promise<string | null> {
      const data = await readStore();
      const entry = data[key] as unknown;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const value = (entry as { value?: unknown }).value;
      return typeof value === 'string' ? value : null;
    },

    async set(key: string, value: string): Promise<void> {
      const data = await readStore();
      data[key] = {
        value,
        updatedAt: new Date().toISOString(),
      };
      await writeStore(data);
    },

    async delete(key: string): Promise<boolean> {
      const data = await readStore();
      if (!(key in data)) return false;
      delete data[key];
      await writeStore(data);
      return true;
    },

    async list(): Promise<readonly IPreference[]> {
      const data = await readStore();
      return Object.entries(data).flatMap(([key, raw]) => {
        const entry = raw as unknown;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const value = (entry as { value?: unknown }).value;
        const updatedAt = (entry as { updatedAt?: unknown }).updatedAt;
        if (typeof value !== 'string' || typeof updatedAt !== 'string') return [];
        return [{ key, value, updatedAt }];
      });
    },

    async has(key: string): Promise<boolean> {
      const data = await readStore();
      return key in data;
    },
  };
}
