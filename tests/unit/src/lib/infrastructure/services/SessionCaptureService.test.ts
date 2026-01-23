import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionCaptureService } from '../../../../../../src/lib/infrastructure/services/SessionCaptureService';

describe('SessionCaptureService', () => {
  describe('findTranscript - deterministic resolution', () => {
    let tempDir: string;
    let originalHome: string | undefined;
    let originalUserProfile: string | undefined;

    beforeEach(() => {
      // Create temp directory for test files
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-transcript-test-'));

      // Save original env
      originalHome = process.env.HOME;
      originalUserProfile = process.env.USERPROFILE;

      // Point HOME to temp dir
      process.env.HOME = tempDir;
      process.env.USERPROFILE = tempDir;
    });

    afterEach(() => {
      // Restore env
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;

      // Clean up temp dir
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should use explicit path when provided and exists', () => {
      // Create explicit transcript
      const explicitPath = path.join(tempDir, 'explicit-transcript.jsonl');
      fs.writeFileSync(explicitPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript(explicitPath);

      assert.strictEqual(result, explicitPath);
    });

    it('should return null when explicit path provided but not found', () => {
      const explicitPath = path.join(tempDir, 'nonexistent.jsonl');

      const service = new SessionCaptureService();
      const result = service.findTranscript(explicitPath);

      assert.strictEqual(result, null);
    });

    it('should not fall back to search when explicit path not found', () => {
      // Create a transcript that would be found by search
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'transcript.jsonl'), '{"type":"user"}\n');

      // But provide an explicit path that doesn't exist
      const explicitPath = path.join(tempDir, 'nonexistent.jsonl');

      const service = new SessionCaptureService();
      const result = service.findTranscript(explicitPath);

      // Should return null, not the one that could be found by search
      assert.strictEqual(result, null);
    });

    it('should find transcript in .claude directory', () => {
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const transcriptPath = path.join(claudeDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, transcriptPath);
    });

    it('should find transcript in .claude/projects subdirectory', () => {
      const projectsDir = path.join(tempDir, '.claude', 'projects', 'myproject');
      fs.mkdirSync(projectsDir, { recursive: true });

      const transcriptPath = path.join(projectsDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, transcriptPath);
    });

    it('should select newest transcript when multiple candidates exist', async () => {
      const projectsDir = path.join(tempDir, '.claude', 'projects');
      const project1Dir = path.join(projectsDir, 'project1');
      const project2Dir = path.join(projectsDir, 'project2');

      fs.mkdirSync(project1Dir, { recursive: true });
      fs.mkdirSync(project2Dir, { recursive: true });

      const olderPath = path.join(project1Dir, 'transcript.jsonl');
      const newerPath = path.join(project2Dir, 'transcript.jsonl');

      // Create older file first
      fs.writeFileSync(olderPath, '{"type":"user","content":"older"}\n');

      // Wait a bit to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create newer file
      fs.writeFileSync(newerPath, '{"type":"user","content":"newer"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      // Should select the newer one
      assert.strictEqual(result, newerPath);
    });

    it('should return null when no transcripts found', () => {
      // Don't create any transcripts
      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, null);
    });

    it('should log warning when multiple candidates found', () => {
      const projectsDir = path.join(tempDir, '.claude', 'projects');
      const project1Dir = path.join(projectsDir, 'project1');
      const project2Dir = path.join(projectsDir, 'project2');

      fs.mkdirSync(project1Dir, { recursive: true });
      fs.mkdirSync(project2Dir, { recursive: true });

      fs.writeFileSync(path.join(project1Dir, 'transcript.jsonl'), '{"type":"user"}\n');
      fs.writeFileSync(path.join(project2Dir, 'transcript.jsonl'), '{"type":"user"}\n');

      let warningLogged = false;
      let warnData: Record<string, unknown> | null = null;

      const mockLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: (msg: string, data?: Record<string, unknown>) => {
          if (msg.includes('Multiple transcript')) {
            warningLogged = true;
            warnData = data || null;
          }
        },
        error: () => {},
        fatal: () => {},
        child: () => mockLogger,
        isLevelEnabled: () => true,
      };

      const service = new SessionCaptureService(mockLogger as unknown as import('../../../../../../src/lib/domain').ILogger);
      service.findTranscript();

      assert.strictEqual(warningLogged, true);
      assert.ok(warnData !== null);
      assert.strictEqual((warnData as Record<string, unknown>).candidateCount, 2);
    });
  });

  describe('parseTranscript', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-parse-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should count user prompts and assistant responses', () => {
      const transcriptPath = path.join(tempDir, 'transcript.jsonl');
      const content = [
        '{"type":"user","message":{"role":"user","content":"Hello"}}',
        '{"type":"assistant","message":{"role":"assistant","content":"Hi there"}}',
        '{"type":"user","message":{"role":"user","content":"Help me"}}',
        '{"type":"assistant","message":{"role":"assistant","content":"Sure"}}',
      ].join('\n');

      fs.writeFileSync(transcriptPath, content);

      const service = new SessionCaptureService();
      const result = service.parseTranscript(transcriptPath);

      assert.strictEqual(result.userPrompts, 2);
      assert.strictEqual(result.assistantResponses, 2);
      assert.strictEqual(result.messageCount, 4);
    });

    it('should count tool calls', () => {
      const transcriptPath = path.join(tempDir, 'transcript.jsonl');
      const content = [
        '{"type":"user","message":{"role":"user","content":"Edit file"}}',
        '{"type":"tool_use","name":"edit"}',
        '{"type":"tool_result","result":"done"}',
        '{"type":"assistant","message":{"role":"assistant","content":"Done"}}',
      ].join('\n');

      fs.writeFileSync(transcriptPath, content);

      const service = new SessionCaptureService();
      const result = service.parseTranscript(transcriptPath);

      assert.strictEqual(result.toolCalls, 2);
    });

    it('should extract file operations from summary', () => {
      const transcriptPath = path.join(tempDir, 'transcript.jsonl');
      const content = [
        '{"type":"user"}',
        '{"summary":"Created: src/new-file.ts"}',
        '{"summary":"Modified: src/existing.ts"}',
        '{"type":"assistant"}',
      ].join('\n');

      fs.writeFileSync(transcriptPath, content);

      const service = new SessionCaptureService();
      const result = service.parseTranscript(transcriptPath);

      assert.ok(result.filesCreated.includes('src/new-file.ts'));
      assert.ok(result.filesModified.includes('src/existing.ts'));
    });
  });

  describe('hasSignificantWork', () => {
    it('should return false for too few messages', () => {
      const service = new SessionCaptureService();
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

      assert.strictEqual(service.hasSignificantWork(work), false);
    });

    it('should return true for file changes', () => {
      const service = new SessionCaptureService();
      const work = {
        messageCount: 5,
        userPrompts: 2,
        assistantResponses: 2,
        toolCalls: 1,
        filesCreated: ['new.ts'],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.strictEqual(service.hasSignificantWork(work), true);
    });

    it('should return true for significant tool usage', () => {
      const service = new SessionCaptureService();
      const work = {
        messageCount: 5,
        userPrompts: 1,
        assistantResponses: 1,
        toolCalls: 5,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.strictEqual(service.hasSignificantWork(work), true);
    });
  });

  describe('rateComplexity', () => {
    it('should rate high complexity for many files', () => {
      const service = new SessionCaptureService();
      const work = {
        messageCount: 10,
        userPrompts: 5,
        assistantResponses: 5,
        toolCalls: 10,
        filesCreated: ['a.ts', 'b.ts', 'c.ts'],
        filesModified: ['d.ts', 'e.ts', 'f.ts'],
        duration: 0,
        summary: '',
      };

      assert.strictEqual(service.rateComplexity(work), 'high');
    });

    it('should rate medium complexity for some file changes', () => {
      const service = new SessionCaptureService();
      const work = {
        messageCount: 8,
        userPrompts: 3,
        assistantResponses: 3,
        toolCalls: 4,
        filesCreated: ['a.ts'],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.strictEqual(service.rateComplexity(work), 'medium');
    });

    it('should rate low complexity for minimal work', () => {
      const service = new SessionCaptureService();
      const work = {
        messageCount: 5,
        userPrompts: 2,
        assistantResponses: 2,
        toolCalls: 2,
        filesCreated: [],
        filesModified: [],
        duration: 0,
        summary: '',
      };

      assert.strictEqual(service.rateComplexity(work), 'low');
    });
  });
});
