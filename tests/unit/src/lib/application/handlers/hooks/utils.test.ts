/**
 * Unit tests for hooks/utils.ts
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'stream';
import {
  readJsonStdin,
  writeJsonStdout,
  writeToStream,
  getHookConfig,
  getUserName,
} from '../../../../../../../src/lib/application/handlers/hooks/utils';

describe('readJsonStdin', () => {
  test('parses valid JSON from stdin', async () => {
    const input = JSON.stringify({ source: 'startup', session_id: '123' });
    const readable = Readable.from([input]);
    
    const result = await readJsonStdin<{ source: string; session_id: string }>(readable);
    
    assert.equal(result.source, 'startup');
    assert.equal(result.session_id, '123');
  });

  test('returns empty object for invalid JSON', async () => {
    const readable = Readable.from(['not valid json']);
    
    const result = await readJsonStdin<Record<string, unknown>>(readable);
    
    assert.deepEqual(result, {});
  });

  test('returns empty object for empty input', async () => {
    const readable = Readable.from(['']);
    
    const result = await readJsonStdin<Record<string, unknown>>(readable);
    
    assert.deepEqual(result, {});
  });

  test('returns empty object when stdin already ended', async () => {
    const readable = new Readable({
      read() {
        this.push(null); // Signal end immediately
      }
    });
    
    const result = await readJsonStdin<Record<string, unknown>>(readable);
    
    assert.deepEqual(result, {});
  });
});

describe('writeJsonStdout', () => {
  test('writes JSON to stdout', async () => {
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    const data = { status: 'ok', message: 'test' };
    await writeJsonStdout(data, writable);

    const output = chunks.join('');
    assert.equal(output, JSON.stringify(data));
  });

  test('handles complex nested objects', async () => {
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    const data = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Memory loaded',
      },
    };
    await writeJsonStdout(data, writable);

    const output = chunks.join('');
    assert.equal(output, JSON.stringify(data));
  });
});

describe('writeToStream', () => {
  test('writes text to stream', async () => {
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    await writeToStream(writable, 'Hello, world!\n');

    const output = chunks.join('');
    assert.equal(output, 'Hello, world!\n');
  });

  test('handles multiple writes', async () => {
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    await writeToStream(writable, 'Line 1\n');
    await writeToStream(writable, 'Line 2\n');

    const output = chunks.join('');
    assert.equal(output, 'Line 1\nLine 2\n');
  });
});

describe('getHookConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns defaults when no env vars set', () => {
    delete process.env.GRAPHITI_ENDPOINT;
    delete process.env.GRAPHITI_GROUP_ID;
    delete process.env.STORAGE_MODE;
    delete process.env.ZEP_API_KEY;

    const config = getHookConfig();

    assert.equal(config.endpoint, 'http://localhost:8010/mcp/');
    assert.equal(config.storageMode, 'local');
    assert.equal(config.zepApiKey, '');
    // groupId depends on cwd/package.json, so we just check it exists
    assert.ok(typeof config.groupId === 'string');
  });

  test('uses GRAPHITI_ENDPOINT from env', () => {
    process.env.GRAPHITI_ENDPOINT = 'http://custom:9000/mcp/';

    const config = getHookConfig();

    assert.equal(config.endpoint, 'http://custom:9000/mcp/');
  });

  test('uses GRAPHITI_GROUP_ID from env', () => {
    process.env.GRAPHITI_GROUP_ID = 'my-custom-group';

    const config = getHookConfig();

    assert.equal(config.groupId, 'my-custom-group');
  });

  test('uses STORAGE_MODE from env', () => {
    process.env.STORAGE_MODE = 'zep-cloud';

    const config = getHookConfig();

    assert.equal(config.storageMode, 'zep-cloud');
  });

  test('uses ZEP_API_KEY from env', () => {
    process.env.ZEP_API_KEY = 'test-api-key';

    const config = getHookConfig();

    assert.equal(config.zepApiKey, 'test-api-key');
  });
});

describe('getUserName', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns USER env var when set', () => {
    process.env.USER = 'testuser';
    delete process.env.USERNAME;

    const result = getUserName();

    assert.equal(result, 'testuser');
  });

  test('returns USERNAME env var when USER not set', () => {
    delete process.env.USER;
    process.env.USERNAME = 'windowsuser';

    const result = getUserName();

    assert.equal(result, 'windowsuser');
  });

  test('returns "unknown" when no env vars set', () => {
    delete process.env.USER;
    delete process.env.USERNAME;

    const result = getUserName();

    assert.equal(result, 'unknown');
  });
});
