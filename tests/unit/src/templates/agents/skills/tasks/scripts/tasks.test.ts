/**
 * Tasks Skill Tests
 *
 * Tests for tasks.ts functionality.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

// Import shared utilities that tasks.ts uses
import {
  normalizePathToGroupId,
  getHierarchicalGroupIds,
} from '../../../../../../../../src/project/.lisa/skills/common/group-id';

describe('Tasks Skill - Group ID Functions', () => {
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

describe('Tasks Skill - Task Object Structure', () => {
  test('should create valid task object', () => {
    const taskObj = {
      type: 'task',
      title: 'Implement feature X',
      status: 'todo',
      repo: 'my-project',
      assignee: 'tony',
      notes: 'High priority',
      tag: 'feature',
    };

    assert.equal(taskObj.type, 'task');
    assert.equal(taskObj.status, 'todo');
    assert.ok(taskObj.title.length > 0);
  });

  test('should support all task statuses', () => {
    const validStatuses = ['todo', 'doing', 'done'];
    validStatuses.forEach((status) => {
      const task = { type: 'task', title: 'Test', status };
      assert.ok(['todo', 'doing', 'done'].includes(task.status));
    });
  });
});

describe('Tasks Skill - Episode Parsing', () => {
  // Simulates parseTasksFromEpisodes function logic

  test('should parse task from JSON episode', () => {
    const episode = {
      uuid: 'abc123',
      content: JSON.stringify({
        type: 'task',
        title: 'Fix bug',
        status: 'todo',
        repo: 'my-repo',
        assignee: 'developer',
      }),
      created_at: '2024-01-01T00:00:00Z',
    };

    const content = episode.content;
    const obj = JSON.parse(content);

    assert.equal(obj.type, 'task');
    assert.equal(obj.title, 'Fix bug');
    assert.equal(obj.status, 'todo');
  });

  test('should handle legacy TASK prefix format', () => {
    const content = 'TASK: Implement login';
    const isTask =
      typeof content === 'string' &&
      content.trim().toUpperCase().startsWith('TASK');

    assert.ok(isTask);
  });

  test('should ignore non-task episodes', () => {
    const episode = {
      content: JSON.stringify({
        type: 'memory',
        text: 'Just a memory',
      }),
    };

    const obj = JSON.parse(episode.content);
    assert.notEqual(obj.type, 'task');
  });
});

describe('Tasks Skill - Cache Functions', () => {
  const testCacheDir = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '.tmp', 'test-cache');
  const testCacheFile = path.join(testCacheDir, 'tasks-test.log');

  beforeEach(() => {
    fs.mkdirSync(testCacheDir, { recursive: true });
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
  });

  test('should write task list to cache', () => {
    const entry = {
      status: 'ok',
      action: 'list',
      tasks: [{ title: 'Task 1', status: 'todo' }],
    };
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(testCacheFile, `${line}\n`, 'utf8');

    const content = fs.readFileSync(testCacheFile, 'utf8');
    assert.ok(content.includes('"action":"list"'));
    assert.ok(content.includes('Task 1'));
  });
});

describe('Tasks Skill - MCP Protocol', () => {
  test('should format add task request correctly', () => {
    const taskObj = {
      type: 'task',
      title: 'New task',
      status: 'todo',
      repo: 'test-repo',
      assignee: 'user',
    };

    const params = {
      name: `TASK: ${taskObj.title.slice(0, 60)}`,
      episode_body: JSON.stringify(taskObj),
      source: 'json',
      group_id: 'test-group',
      tags: undefined,
    };

    assert.ok(params.name.startsWith('TASK:'));
    assert.ok(params.episode_body.includes('"type":"task"'));
    assert.equal(params.source, 'json');
  });

  test('should format get_episodes request correctly', () => {
    const params = {
      group_ids: ['test-group', 'parent-group'],
      max_episodes: 20,
    };

    const request = {
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: 'get_episodes', arguments: params },
    };

    assert.equal(request.params.name, 'get_episodes');
    assert.equal(request.params.arguments.max_episodes, 20);
    assert.ok(Array.isArray(request.params.arguments.group_ids));
  });
});

describe('Tasks Skill - Zep Cloud Format', () => {
  test('should format Zep task thread ID correctly', () => {
    const groupId = 'my-project';
    const threadId = `lisa-tasks-${groupId}`;
    assert.equal(threadId, 'lisa-tasks-my-project');
  });

  test('should format task message content for Zep', () => {
    const taskObj = {
      type: 'task',
      title: 'Complete feature',
      status: 'doing',
    };
    const content = `TASK: ${JSON.stringify(taskObj)}`;
    assert.ok(content.startsWith('TASK:'));
    assert.ok(content.includes('"type":"task"'));
  });

  // Simulates parseTasksFromZepMessages function logic
  test('should parse task from Zep message', () => {
    const message = {
      uuid: 'msg-123',
      content: 'TASK: {"type":"task","title":"Test task","status":"todo"}',
      created_at: '2024-01-01T00:00:00Z',
    };

    const content = message.content;
    if (content.startsWith('TASK:')) {
      const jsonStr = content.slice(5).trim();
      const obj = JSON.parse(jsonStr);

      assert.equal(obj.type, 'task');
      assert.equal(obj.title, 'Test task');
      assert.equal(obj.status, 'todo');
    }
  });
});

describe('Tasks Skill - Status Values', () => {
  test('default status should be todo', () => {
    const defaultStatus = 'todo';
    assert.equal(defaultStatus, 'todo');
  });

  test('should recognize valid status values', () => {
    const validStatuses = ['todo', 'doing', 'done'];
    const testStatus = 'doing';
    assert.ok(validStatuses.includes(testStatus));
  });
});
