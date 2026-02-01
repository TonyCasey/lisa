/**
 * Tests for PreferenceStore.
 *
 * Tests file-based preference key-value store operations:
 * get, set, delete, list, has, and edge cases (missing file, invalid JSON).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPreferenceStore } from '../../../../../../src/lib/infrastructure/services/PreferenceStore';
import type { IPreferenceStore } from '../../../../../../src/lib/domain/interfaces/IPreferenceStore';

describe('PreferenceStore', () => {
  let tmpDir: string;
  let store: IPreferenceStore;
  let prefFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-pref-test-'));
    store = createPreferenceStore(tmpDir);
    prefFile = path.join(tmpDir, '.lisa', 'preferences.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('get()', () => {
    it('should return null for missing key', async () => {
      const value = await store.get('nonexistent');
      assert.strictEqual(value, null);
    });

    it('should return stored value', async () => {
      await store.set('theme', 'dark');
      const value = await store.get('theme');
      assert.strictEqual(value, 'dark');
    });

    it('should return null when preferences file does not exist', async () => {
      const value = await store.get('anything');
      assert.strictEqual(value, null);
    });
  });

  describe('set()', () => {
    it('should create new key', async () => {
      await store.set('editor', 'vscode');
      const value = await store.get('editor');
      assert.strictEqual(value, 'vscode');
    });

    it('should overwrite existing key', async () => {
      await store.set('editor', 'vscode');
      await store.set('editor', 'neovim');
      const value = await store.get('editor');
      assert.strictEqual(value, 'neovim');
    });

    it('should update timestamp on overwrite', async () => {
      await store.set('key', 'value1');
      const data1 = JSON.parse(fs.readFileSync(prefFile, 'utf-8'));
      const ts1 = data1.key.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.set('key', 'value2');
      const data2 = JSON.parse(fs.readFileSync(prefFile, 'utf-8'));
      const ts2 = data2.key.updatedAt;

      assert.notStrictEqual(ts1, ts2);
    });

    it('should create .lisa directory on first write', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      assert.ok(!fs.existsSync(lisaDir), '.lisa should not exist before first write');

      await store.set('key', 'value');

      assert.ok(fs.existsSync(lisaDir), '.lisa should exist after first write');
      assert.ok(fs.existsSync(prefFile), 'preferences.json should exist');
    });

    it('should persist data to file', async () => {
      await store.set('persist-key', 'persist-value');

      // Read file directly
      const content = fs.readFileSync(prefFile, 'utf-8');
      const data = JSON.parse(content);
      assert.strictEqual(data['persist-key'].value, 'persist-value');
      assert.ok(data['persist-key'].updatedAt);
    });
  });

  describe('delete()', () => {
    it('should remove key and return true', async () => {
      await store.set('to-delete', 'value');
      const result = await store.delete('to-delete');
      assert.strictEqual(result, true);

      const value = await store.get('to-delete');
      assert.strictEqual(value, null);
    });

    it('should return false for missing key', async () => {
      const result = await store.delete('nonexistent');
      assert.strictEqual(result, false);
    });

    it('should not affect other keys', async () => {
      await store.set('keep', 'keepval');
      await store.set('remove', 'removeval');

      await store.delete('remove');

      assert.strictEqual(await store.get('keep'), 'keepval');
      assert.strictEqual(await store.get('remove'), null);
    });
  });

  describe('list()', () => {
    it('should return all preferences', async () => {
      await store.set('a', '1');
      await store.set('b', '2');
      await store.set('c', '3');

      const prefs = await store.list();
      assert.strictEqual(prefs.length, 3);

      const keys = prefs.map((p) => p.key).sort();
      assert.deepStrictEqual(keys, ['a', 'b', 'c']);

      const aEntry = prefs.find((p) => p.key === 'a');
      assert.strictEqual(aEntry?.value, '1');
      assert.ok(aEntry?.updatedAt);
    });

    it('should return empty array for empty store', async () => {
      const prefs = await store.list();
      assert.strictEqual(prefs.length, 0);
    });

    it('should return empty array when file does not exist', async () => {
      const prefs = await store.list();
      assert.strictEqual(prefs.length, 0);
      assert.ok(Array.isArray(prefs));
    });
  });

  describe('has()', () => {
    it('should return true for existing key', async () => {
      await store.set('exists', 'value');
      assert.strictEqual(await store.has('exists'), true);
    });

    it('should return false for missing key', async () => {
      assert.strictEqual(await store.has('missing'), false);
    });

    it('should return false when file does not exist', async () => {
      assert.strictEqual(await store.has('anything'), false);
    });
  });

  describe('Edge cases', () => {
    it('should handle missing preferences.json gracefully', async () => {
      // No file exists — all operations should work
      assert.strictEqual(await store.get('key'), null);
      assert.strictEqual(await store.has('key'), false);
      assert.strictEqual(await store.delete('key'), false);
      assert.deepStrictEqual(await store.list(), []);
    });

    it('should handle invalid JSON gracefully and reset file', async () => {
      // Create .lisa dir and write invalid JSON
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(prefFile, 'this is not json!!!', 'utf-8');

      const warnings: string[] = [];
      const storeWithLogger = createPreferenceStore(tmpDir, {
        warn: (msg: string) => { warnings.push(msg); },
      });

      // Should return empty, not throw
      const value = await storeWithLogger.get('key');
      assert.strictEqual(value, null);
      assert.ok(warnings.some((w) => w.includes('Invalid JSON')));

      // File should be reset to empty JSON
      const content = fs.readFileSync(prefFile, 'utf-8');
      assert.deepStrictEqual(JSON.parse(content), {});
    });

    it('should handle non-object JSON gracefully and reset file', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(prefFile, '"just a string"', 'utf-8');

      const warnings: string[] = [];
      const storeWithLogger = createPreferenceStore(tmpDir, {
        warn: (msg: string) => { warnings.push(msg); },
      });

      const value = await storeWithLogger.get('key');
      assert.strictEqual(value, null);
      assert.ok(warnings.some((w) => w.includes('Invalid preferences.json structure')));

      // File should be reset to empty JSON
      const content = fs.readFileSync(prefFile, 'utf-8');
      assert.deepStrictEqual(JSON.parse(content), {});
    });

    it('should handle array JSON gracefully and reset file', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(prefFile, '[1, 2, 3]', 'utf-8');

      const warnings: string[] = [];
      const storeWithLogger = createPreferenceStore(tmpDir, {
        warn: (msg: string) => { warnings.push(msg); },
      });

      const prefs = await storeWithLogger.list();
      assert.deepStrictEqual(prefs, []);
      assert.ok(warnings.some((w) => w.includes('Invalid preferences.json structure')));

      // File should be reset to empty JSON
      const content = fs.readFileSync(prefFile, 'utf-8');
      assert.deepStrictEqual(JSON.parse(content), {});
    });

    it('should skip malformed entries in get()', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      // Write store with a malformed entry (value is not a string)
      fs.writeFileSync(prefFile, JSON.stringify({
        good: { value: 'valid', updatedAt: '2026-01-01T00:00:00Z' },
        bad_number: { value: 42, updatedAt: '2026-01-01T00:00:00Z' },
        bad_shape: 'just a string',
        bad_null: null,
      }), 'utf-8');

      assert.strictEqual(await store.get('good'), 'valid');
      assert.strictEqual(await store.get('bad_number'), null);
      assert.strictEqual(await store.get('bad_shape'), null);
      assert.strictEqual(await store.get('bad_null'), null);
    });

    it('should skip malformed entries in list()', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(prefFile, JSON.stringify({
        good: { value: 'valid', updatedAt: '2026-01-01T00:00:00Z' },
        bad_number: { value: 42, updatedAt: '2026-01-01T00:00:00Z' },
        bad_shape: 'just a string',
      }), 'utf-8');

      const prefs = await store.list();
      assert.strictEqual(prefs.length, 1);
      assert.strictEqual(prefs[0].key, 'good');
      assert.strictEqual(prefs[0].value, 'valid');
    });

    it('should produce human-readable JSON output', async () => {
      await store.set('format-test', 'value');
      const content = fs.readFileSync(prefFile, 'utf-8');

      // Should be pretty-printed (indented) and end with newline
      assert.ok(content.includes('  '), 'should be indented');
      assert.ok(content.endsWith('\n'), 'should end with newline');
    });

    it('should persist across store instances', async () => {
      await store.set('persist', 'across-instances');

      // Create a new store pointing to same directory
      const store2 = createPreferenceStore(tmpDir);
      const value = await store2.get('persist');
      assert.strictEqual(value, 'across-instances');
    });
  });
});
