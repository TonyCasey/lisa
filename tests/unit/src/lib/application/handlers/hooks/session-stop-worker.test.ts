/**
 * Unit tests for session-stop-worker
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTranscript,
  hasSignificantWork,
} from '../../../../../../../src/lib/application/handlers/hooks/session-stop-worker';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('session-stop-worker', () => {
  describe('parseTranscript', () => {
    test('parses valid transcript with user and assistant messages', () => {
      // Create a temporary transcript file
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-transcript-'));
      const transcriptPath = path.join(tmpDir, 'transcript.jsonl');

      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi there!' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Help me with code' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Sure, let me help.' } }),
        JSON.stringify({ type: 'tool_use' }),
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const result = parseTranscript(transcriptPath);

      assert.equal(result.messageCount, 5);
      assert.equal(result.userPrompts, 2);
      assert.equal(result.assistantResponses, 2);
      assert.equal(result.toolCalls, 1);

      // Cleanup
      fs.unlinkSync(transcriptPath);
      fs.rmdirSync(tmpDir);
    });

    test('handles empty transcript', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-transcript-'));
      const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '');

      const result = parseTranscript(transcriptPath);

      assert.equal(result.messageCount, 0);
      assert.equal(result.userPrompts, 0);
      assert.equal(result.assistantResponses, 0);

      // Cleanup
      fs.unlinkSync(transcriptPath);
      fs.rmdirSync(tmpDir);
    });

    test('handles malformed JSON lines gracefully', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-transcript-'));
      const transcriptPath = path.join(tmpDir, 'transcript.jsonl');

      const lines = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        'not valid json',
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi!' } }),
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n'));

      const result = parseTranscript(transcriptPath);

      // Should skip malformed line
      assert.equal(result.userPrompts, 1);
      assert.equal(result.assistantResponses, 1);

      // Cleanup
      fs.unlinkSync(transcriptPath);
      fs.rmdirSync(tmpDir);
    });
  });

  describe('hasSignificantWork', () => {
    test('returns false for empty work', () => {
      const work = {
        messageCount: 0,
        userPrompts: 0,
        assistantResponses: 0,
        toolCalls: 0,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), false);
    });

    test('returns false for too few messages', () => {
      const work = {
        messageCount: 2,
        userPrompts: 1,
        assistantResponses: 1,
        toolCalls: 0,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), false);
    });

    test('returns true for work with file changes', () => {
      const work = {
        messageCount: 5,
        userPrompts: 2,
        assistantResponses: 2,
        toolCalls: 1,
        filesCreated: ['src/new-file.ts'],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), true);
    });

    test('returns true for work with many tool calls', () => {
      const work = {
        messageCount: 5,
        userPrompts: 2,
        assistantResponses: 2,
        toolCalls: 5,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), true);
    });

    test('returns true for substantial conversation', () => {
      const work = {
        messageCount: 10,
        userPrompts: 5,
        assistantResponses: 5,
        toolCalls: 0,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), true);
    });

    test('returns false without user interaction', () => {
      const work = {
        messageCount: 5,
        userPrompts: 0,
        assistantResponses: 5,
        toolCalls: 0,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.equal(hasSignificantWork(work), false);
    });
  });
});
