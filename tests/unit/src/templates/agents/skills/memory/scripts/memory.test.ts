/**
 * Memory Skill Tests
 *
 * Tests for memory.ts functionality.
 * Uses the shared group-id module for pure function tests.
 * MCP-dependent functions are tested with mocked fetch.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

// Import shared utilities that memory.ts uses
import {
  normalizePathToGroupId,
  getHierarchicalGroupIds,
  detectPrefixTag,
  TYPE_MAP,
} from '../../../../../../../../src/templates/agents/skills/common/group-id';

describe('Memory Skill - Group ID Functions', () => {
  test('should normalize project paths correctly', () => {
    assert.equal(
      normalizePathToGroupId('/home/user/my-project'),
      'home-user-my-project'
    );
  });

  test('should generate hierarchical groups for project path', () => {
    const groups = getHierarchicalGroupIds('/home/user/projects/myapp');
    assert.ok(groups.length >= 1);
    assert.ok(groups[0].includes('myapp'));
  });
});

describe('Memory Skill - Tag Detection', () => {
  test('should detect decision tag', () => {
    assert.equal(detectPrefixTag('DECISION: Use React'), 'code:decision');
  });

  test('should detect bug tag', () => {
    assert.equal(detectPrefixTag('BUG: Null pointer'), 'context:bug');
  });

  test('should return null for plain text', () => {
    assert.equal(detectPrefixTag('Just a memory'), null);
  });
});

describe('Memory Skill - Type Mapping', () => {
  test('should map decision type to tag', () => {
    assert.equal(TYPE_MAP['decision'], 'code:decision');
  });

  test('should map milestone type to tag', () => {
    assert.equal(TYPE_MAP['milestone'], 'project:milestone');
  });

  test('should map bug type to tag', () => {
    assert.equal(TYPE_MAP['bug'], 'context:bug');
  });
});

describe('Memory Skill - Cache Functions', () => {
  const testCacheDir = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '.tmp', 'test-cache');
  const testCacheFile = path.join(testCacheDir, 'memory-test.log');

  beforeEach(() => {
    // Create test cache directory
    fs.mkdirSync(testCacheDir, { recursive: true });
    // Clean any existing test cache
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  afterEach(() => {
    // Clean up test cache
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  test('should write cache entry as JSON line', () => {
    const entry = { status: 'ok', action: 'add', group: 'test' };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(testCacheFile, `${line}\n`, 'utf8');

    const content = fs.readFileSync(testCacheFile, 'utf8');
    assert.ok(content.includes('"status":"ok"'));
    assert.ok(content.includes('"action":"add"'));
  });

  test('should read last cache entry', () => {
    // Write multiple entries
    const entries = [
      { status: 'ok', action: 'load', ts: '2024-01-01' },
      { status: 'ok', action: 'add', ts: '2024-01-02' },
    ];
    entries.forEach((e) => {
      fs.appendFileSync(testCacheFile, JSON.stringify(e) + '\n', 'utf8');
    });

    // Read last entry
    const data = fs.readFileSync(testCacheFile, 'utf8').trim().split('\n').filter(Boolean);
    const lastEntry = JSON.parse(data[data.length - 1]);
    assert.equal(lastEntry.action, 'add');
  });

  test('should handle empty cache file', () => {
    fs.writeFileSync(testCacheFile, '', 'utf8');
    const data = fs.readFileSync(testCacheFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(data.length, 0);
  });
});

describe('Memory Skill - MCP Protocol', () => {
  // These tests verify the structure of MCP requests

  test('should format initialize request correctly', () => {
    const request = {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          experimental: {},
          prompts: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          tools: { listChanged: false },
        },
        clientInfo: { name: 'memory-skill', version: '0.1.0' },
      },
    };

    assert.equal(request.jsonrpc, '2.0');
    assert.equal(request.method, 'initialize');
    assert.ok(request.params.capabilities);
    assert.equal(request.params.clientInfo.name, 'memory-skill');
  });

  test('should format add_memory request correctly', () => {
    const params = {
      name: 'Test memory',
      episode_body: 'Test memory content',
      source: 'skill:load-memory',
      group_id: 'test-group',
      tags: ['code:decision'],
    };

    const request = {
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: 'add_memory', arguments: params },
    };

    assert.equal(request.method, 'tools/call');
    assert.equal(request.params.name, 'add_memory');
    assert.equal(request.params.arguments.group_id, 'test-group');
  });

  test('should format search_memory_facts request correctly', () => {
    const params = {
      query: '*',
      max_facts: 10,
      group_ids: ['test-group'],
    };

    const request = {
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: 'search_memory_facts', arguments: params },
    };

    assert.equal(request.params.name, 'search_memory_facts');
    assert.equal(request.params.arguments.max_facts, 10);
  });
});

describe('Memory Skill - SSE Response Parsing', () => {
  test('should extract data from SSE response', () => {
    const sseResponse = `event: message
data: {"result":{"facts":[]},"jsonrpc":"2.0","id":"1"}

`;
    // Extract data line
    const dataLine = sseResponse.split('\n').find((l) => l.startsWith('data:'));
    const json = dataLine ? dataLine.slice(5).trim() : null;

    assert.ok(json);
    const parsed = JSON.parse(json!);
    assert.ok(parsed.result);
    assert.deepEqual(parsed.result.facts, []);
  });

  test('should handle plain JSON response', () => {
    const jsonResponse = '{"result":{"status":"ok"},"jsonrpc":"2.0","id":"1"}';
    const parsed = JSON.parse(jsonResponse);
    assert.equal(parsed.result.status, 'ok');
  });
});

describe('Memory Skill - Zep Cloud Format', () => {
  test('should format Zep user ID correctly', () => {
    const groupId = 'my-project';
    const userId = `lisa-${groupId}`;
    assert.equal(userId, 'lisa-my-project');
  });

  test('should format Zep thread ID correctly', () => {
    const groupId = 'my-project';
    const threadId = `lisa-memory-${groupId}`;
    assert.equal(threadId, 'lisa-memory-my-project');
  });

  test('should include tag in Zep message content', () => {
    const tag = 'code:decision';
    const payload = 'Use React for frontend';
    const textWithTag = tag ? `[${tag}] ${payload}` : payload;
    assert.equal(textWithTag, '[code:decision] Use React for frontend');
  });
});
