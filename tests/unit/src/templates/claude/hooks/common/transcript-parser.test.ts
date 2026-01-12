/**
 * Tests for Transcript Parser
 *
 * Tests the JSONL transcript parsing for Claude Code sessions.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Import the module (CommonJS style)
const { parseTranscript, formatDuration } = require('../../../../../../../src/templates/claude/hooks/common/transcript-parser');

describe('parseTranscript', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
    tempFile = path.join(tempDir, 'transcript.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  it('should return empty summary for non-existent file', () => {
    const result = parseTranscript('/non/existent/path.jsonl');
    assert.strictEqual(result.filesModified.size, 0);
    assert.strictEqual(result.filesCreated.size, 0);
    assert.strictEqual(result.commandsRun.length, 0);
    assert.strictEqual(result.toolsUsed.size, 0);
  });

  it('should parse empty file', () => {
    fs.writeFileSync(tempFile, '');
    const result = parseTranscript(tempFile);
    assert.strictEqual(result.filesModified.size, 0);
  });

  it('should extract file writes', () => {
    const entries = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: '/project/src/new-file.ts', content: 'export {}' },
            },
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.filesCreated.size, 1);
    assert.ok(result.filesCreated.has('/project/src/new-file.ts'));
  });

  it('should extract file edits', () => {
    const entries = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: '/project/src/existing.ts', old_string: 'a', new_string: 'b' },
            },
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.filesModified.size, 1);
    assert.ok(result.filesModified.has('/project/src/existing.ts'));
  });

  it('should extract bash commands', () => {
    const entries = [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'npm install lodash' },
            },
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.commandsRun.length, 1);
    assert.ok(result.commandsRun[0].includes('npm install'));
  });

  it('should skip read-only commands', () => {
    const entries = [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'cat file.txt' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } }, // This should be kept
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.commandsRun.length, 1);
    assert.ok(result.commandsRun[0].includes('npm run build'));
  });

  it('should track tool usage counts', () => {
    const entries = [
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'b.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'c.ts' } },
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.toolsUsed.get('Read'), 2);
    assert.strictEqual(result.toolsUsed.get('Edit'), 1);
  });

  it('should skip sidechain entries', () => {
    const entries = [
      {
        isSidechain: true,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'sidechain.ts' } },
          ],
        },
      },
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'main.ts' } },
          ],
        },
      },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.filesCreated.size, 1);
    assert.ok(result.filesCreated.has('main.ts'));
    assert.ok(!result.filesCreated.has('sidechain.ts'));
  });

  it('should calculate duration from timestamps', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const endTime = new Date('2024-01-01T10:05:00Z');

    const entries = [
      { timestamp: startTime.toISOString(), message: { role: 'user', content: 'start' } },
      { timestamp: endTime.toISOString(), message: { role: 'assistant', content: 'done' } },
    ];
    fs.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    const result = parseTranscript(tempFile);
    assert.strictEqual(result.durationMs, 5 * 60 * 1000); // 5 minutes
  });

  it('should handle malformed JSON lines gracefully', () => {
    const content = [
      '{"message": {"role": "user", "content": "hello"}}',
      'not valid json',
      '{"message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Write", "input": {"file_path": "test.ts"}}]}}',
    ].join('\n');
    fs.writeFileSync(tempFile, content);

    const result = parseTranscript(tempFile);
    // Should still parse the valid entries
    assert.strictEqual(result.filesCreated.size, 1);
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    assert.strictEqual(formatDuration(500), '500ms');
  });

  it('should format seconds', () => {
    assert.strictEqual(formatDuration(5000), '5s');
    assert.strictEqual(formatDuration(45000), '45s');
  });

  it('should format minutes and seconds', () => {
    assert.strictEqual(formatDuration(65000), '1m 5s');
    assert.strictEqual(formatDuration(125000), '2m 5s');
  });

  it('should format hours and minutes', () => {
    assert.strictEqual(formatDuration(3665000), '1h 1m');
    assert.strictEqual(formatDuration(7200000), '2h 0m');
  });
});
