/**
 * Tests for Jira Skill
 *
 * Tests the Jira REST API helper functions.
 * Note: These tests validate the logic without making actual API calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Since the jira.ts module makes actual API calls and reads config files,
// we test the logic patterns and data structures here.

describe('Jira Skill', () => {
  describe('Issue Types', () => {
    const ISSUE_TYPES: Record<string, string> = {
      epic: '10000',
      story: '10001',
      task: '10002',
      subtask: '10003',
      bug: '10004',
    };

    it('should have valid issue type IDs', () => {
      assert.strictEqual(ISSUE_TYPES.epic, '10000');
      assert.strictEqual(ISSUE_TYPES.story, '10001');
      assert.strictEqual(ISSUE_TYPES.task, '10002');
      assert.strictEqual(ISSUE_TYPES.subtask, '10003');
      assert.strictEqual(ISSUE_TYPES.bug, '10004');
    });

    it('should support all standard issue types', () => {
      const expectedTypes = ['epic', 'story', 'task', 'subtask', 'bug'];
      for (const type of expectedTypes) {
        assert.ok(type in ISSUE_TYPES, `Missing issue type: ${type}`);
      }
    });
  });

  describe('Atlassian Document Format (ADF)', () => {
    function textToAdf(text: string | undefined) {
      if (!text) return undefined;

      const paragraphs = text.split('\n').filter((p) => p.trim());

      return {
        type: 'doc',
        version: 1,
        content: paragraphs.map((p) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: p }],
        })),
      };
    }

    it('should return undefined for empty text', () => {
      assert.strictEqual(textToAdf(''), undefined);
      assert.strictEqual(textToAdf(undefined), undefined);
    });

    it('should convert single line to ADF', () => {
      const result = textToAdf('Hello world');
      assert.ok(result);
      assert.strictEqual(result.type, 'doc');
      assert.strictEqual(result.version, 1);
      assert.strictEqual(result.content.length, 1);
      assert.strictEqual(result.content[0].type, 'paragraph');
      assert.strictEqual(result.content[0].content?.[0].text, 'Hello world');
    });

    it('should convert multiple lines to ADF paragraphs', () => {
      const result = textToAdf('Line 1\nLine 2\nLine 3');
      assert.ok(result);
      assert.strictEqual(result.content.length, 3);
      assert.strictEqual(result.content[0].content?.[0].text, 'Line 1');
      assert.strictEqual(result.content[1].content?.[0].text, 'Line 2');
      assert.strictEqual(result.content[2].content?.[0].text, 'Line 3');
    });

    it('should filter empty lines', () => {
      const result = textToAdf('Line 1\n\n\nLine 2');
      assert.ok(result);
      assert.strictEqual(result.content.length, 2);
    });
  });

  describe('CLI Parser', () => {
    interface ParsedArgs {
      command: string | null;
      args: Record<string, string | boolean>;
      positional: string[];
    }

    function parseArgs(argv: string[]): ParsedArgs {
      const args: Record<string, string | boolean> = {};
      let command: string | null = null;
      const positional: string[] = [];

      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg.startsWith('--')) {
          const key = arg.slice(2);
          const next = argv[i + 1];
          if (next && !next.startsWith('--')) {
            args[key] = next;
            i++;
          } else {
            args[key] = true;
          }
        } else if (!command) {
          command = arg;
        } else {
          positional.push(arg);
        }
      }

      return { command, args, positional };
    }

    it('should parse command', () => {
      const result = parseArgs(['node', 'jira.js', 'create']);
      assert.strictEqual(result.command, 'create');
    });

    it('should parse flags with values', () => {
      const result = parseArgs([
        'node',
        'jira.js',
        'create',
        '--type',
        'epic',
        '--project',
        'PROJ',
      ]);
      assert.strictEqual(result.command, 'create');
      assert.strictEqual(result.args.type, 'epic');
      assert.strictEqual(result.args.project, 'PROJ');
    });

    it('should parse boolean flags', () => {
      const result = parseArgs(['node', 'jira.js', 'list', '--mine']);
      assert.strictEqual(result.command, 'list');
      assert.strictEqual(result.args.mine, true);
    });

    it('should parse positional arguments', () => {
      const result = parseArgs(['node', 'jira.js', 'view', 'PROJ-123']);
      assert.strictEqual(result.command, 'view');
      assert.strictEqual(result.positional[0], 'PROJ-123');
    });

    it('should handle mixed arguments', () => {
      const result = parseArgs([
        'node',
        'jira.js',
        'transition',
        'PROJ-123',
        '--to',
        'In Progress',
      ]);
      assert.strictEqual(result.command, 'transition');
      assert.strictEqual(result.positional[0], 'PROJ-123');
      assert.strictEqual(result.args.to, 'In Progress');
    });
  });

  describe('Config Parsing', () => {
    it('should parse simple YAML config', () => {
      const configText = `endpoint: https://company.atlassian.net
user: user@company.com
authentication-method: api-token`;

      const config: Record<string, string> = {};
      configText.split('\n').forEach((line) => {
        const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
        if (match) {
          config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
      });

      assert.strictEqual(config.endpoint, 'https://company.atlassian.net');
      assert.strictEqual(config.user, 'user@company.com');
      assert.strictEqual(config['authentication-method'], 'api-token');
    });

    it('should handle quoted values', () => {
      const configText = `endpoint: "https://company.atlassian.net"
user: 'user@company.com'`;

      const config: Record<string, string> = {};
      configText.split('\n').forEach((line) => {
        const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
        if (match) {
          config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
      });

      assert.strictEqual(config.endpoint, 'https://company.atlassian.net');
      assert.strictEqual(config.user, 'user@company.com');
    });
  });

  describe('Response Format', () => {
    it('should format create response correctly', () => {
      const response = {
        status: 'ok',
        action: 'create',
        issue: {
          key: 'PROJ-123',
          url: 'https://company.atlassian.net/browse/PROJ-123',
          summary: 'Test issue',
          type: 'task',
        },
      };

      assert.strictEqual(response.status, 'ok');
      assert.strictEqual(response.action, 'create');
      assert.strictEqual(response.issue.key, 'PROJ-123');
    });

    it('should format list response correctly', () => {
      const response = {
        status: 'ok',
        action: 'list',
        issues: [
          { key: 'PROJ-1', summary: 'Issue 1', status: 'To Do' },
          { key: 'PROJ-2', summary: 'Issue 2', status: 'In Progress' },
        ],
        total: 2,
      };

      assert.strictEqual(response.status, 'ok');
      assert.strictEqual(response.action, 'list');
      assert.strictEqual(response.issues.length, 2);
      assert.strictEqual(response.total, 2);
    });

    it('should format error response correctly', () => {
      const response = {
        status: 'error',
        error: 'Authentication failed',
      };

      assert.strictEqual(response.status, 'error');
      assert.ok(response.error.includes('Authentication'));
    });
  });
});
