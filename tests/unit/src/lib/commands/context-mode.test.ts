/**
 * Tests for context mode CLI functions.
 *
 * Tests readContextMode, writeContextMode, clearContextMode
 * used by `lisa context set-mode` and `lisa context get-mode` commands.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readContextMode, writeContextMode, clearContextMode } from '../../../../../src/lib/commands/knowledge';

describe('context-mode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-context-mode-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readContextMode', () => {
    it('should return null when .lisa/.context-mode does not exist', () => {
      const result = readContextMode(tmpDir);
      assert.strictEqual(result, null);
    });

    it('should return null when .lisa directory does not exist', () => {
      const result = readContextMode(path.join(tmpDir, 'nonexistent'));
      assert.strictEqual(result, null);
    });

    it('should return the mode when file contains a valid task type', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(path.join(lisaDir, '.context-mode'), 'debugging\n', 'utf-8');

      const result = readContextMode(tmpDir);
      assert.strictEqual(result, 'debugging');
    });

    it('should return null when file contains "auto"', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(path.join(lisaDir, '.context-mode'), 'auto\n', 'utf-8');

      const result = readContextMode(tmpDir);
      assert.strictEqual(result, null);
    });

    it('should return null when file contains invalid mode', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(path.join(lisaDir, '.context-mode'), 'invalid-mode\n', 'utf-8');

      const result = readContextMode(tmpDir);
      assert.strictEqual(result, null);
    });

    it('should return null when file is empty', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(path.join(lisaDir, '.context-mode'), '', 'utf-8');

      const result = readContextMode(tmpDir);
      assert.strictEqual(result, null);
    });

    it('should trim whitespace from mode value', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });
      fs.writeFileSync(path.join(lisaDir, '.context-mode'), '  planning  \n', 'utf-8');

      const result = readContextMode(tmpDir);
      assert.strictEqual(result, 'planning');
    });

    it('should read all valid task types', () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      fs.mkdirSync(lisaDir, { recursive: true });

      for (const mode of ['planning', 'execution', 'exploration', 'debugging']) {
        fs.writeFileSync(path.join(lisaDir, '.context-mode'), mode + '\n', 'utf-8');
        const result = readContextMode(tmpDir);
        assert.strictEqual(result, mode, `Should read mode: ${mode}`);
      }
    });
  });

  describe('writeContextMode', () => {
    it('should create .lisa directory if it does not exist', () => {
      writeContextMode(tmpDir, 'planning');

      const lisaDir = path.join(tmpDir, '.lisa');
      assert.ok(fs.existsSync(lisaDir), '.lisa directory should exist');
    });

    it('should write mode to .lisa/.context-mode', () => {
      writeContextMode(tmpDir, 'debugging');

      const content = fs.readFileSync(
        path.join(tmpDir, '.lisa', '.context-mode'),
        'utf-8'
      );
      assert.strictEqual(content, 'debugging\n');
    });

    it('should overwrite existing mode', () => {
      writeContextMode(tmpDir, 'planning');
      writeContextMode(tmpDir, 'execution');

      const content = fs.readFileSync(
        path.join(tmpDir, '.lisa', '.context-mode'),
        'utf-8'
      );
      assert.strictEqual(content, 'execution\n');
    });

    it('should be readable by readContextMode', () => {
      writeContextMode(tmpDir, 'exploration');
      const result = readContextMode(tmpDir);
      assert.strictEqual(result, 'exploration');
    });
  });

  describe('clearContextMode', () => {
    it('should remove .lisa/.context-mode file', () => {
      writeContextMode(tmpDir, 'debugging');
      clearContextMode(tmpDir);

      const filePath = path.join(tmpDir, '.lisa', '.context-mode');
      assert.ok(!fs.existsSync(filePath), 'File should be removed');
    });

    it('should not throw when file does not exist', () => {
      assert.doesNotThrow(() => {
        clearContextMode(tmpDir);
      });
    });

    it('should result in readContextMode returning null', () => {
      writeContextMode(tmpDir, 'planning');
      clearContextMode(tmpDir);
      const result = readContextMode(tmpDir);
      assert.strictEqual(result, null);
    });
  });
});
