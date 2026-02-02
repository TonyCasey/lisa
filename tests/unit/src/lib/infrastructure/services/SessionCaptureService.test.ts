import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionCaptureService } from '../../../../../../src/lib/infrastructure/services/SessionCaptureService';
import type { ITranscriptEnricher, IEnrichmentResult } from '../../../../../../src/lib/domain/interfaces/ITranscriptEnricher';
import type { IWorkSummary } from '../../../../../../src/lib/infrastructure/services/SessionCaptureService';

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

    it('should find UUID-named transcript in project directory', () => {
      // Derive the project folder from CWD (same logic as the service)
      const projectFolderName = process.cwd().replace(/[:\\/]/g, '-');
      const projectDir = path.join(tempDir, '.claude', 'projects', projectFolderName);
      fs.mkdirSync(projectDir, { recursive: true });

      const transcriptPath = path.join(projectDir, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, transcriptPath);
    });

    it('should select newest transcript when multiple sessions exist', async () => {
      const projectFolderName = process.cwd().replace(/[:\\/]/g, '-');
      const projectDir = path.join(tempDir, '.claude', 'projects', projectFolderName);
      fs.mkdirSync(projectDir, { recursive: true });

      const olderPath = path.join(projectDir, '00000000-0000-0000-0000-000000000001.jsonl');
      const newerPath = path.join(projectDir, '00000000-0000-0000-0000-000000000002.jsonl');

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

    it('should ignore non-UUID files and subagent directories', () => {
      const projectFolderName = process.cwd().replace(/[:\\/]/g, '-');
      const projectDir = path.join(tempDir, '.claude', 'projects', projectFolderName);
      const subagentDir = path.join(projectDir, '00000000-0000-0000-0000-000000000001', 'subagents');
      fs.mkdirSync(subagentDir, { recursive: true });

      // Non-UUID file — should be ignored
      fs.writeFileSync(path.join(projectDir, 'notes.jsonl'), '{"type":"user"}\n');

      // Subagent file inside a subdirectory — should be ignored (not a direct file)
      fs.writeFileSync(path.join(subagentDir, 'agent-a12345.jsonl'), '{"type":"user"}\n');

      // Valid UUID file — should be found
      const validPath = path.join(projectDir, 'abcdef01-2345-6789-abcd-ef0123456789.jsonl');
      fs.writeFileSync(validPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, validPath);
    });

    it('should fall back to scanning all projects when CWD folder not found', () => {
      // Create a project folder with a different name than CWD-derived
      const otherProjectDir = path.join(tempDir, '.claude', 'projects', 'other-project');
      fs.mkdirSync(otherProjectDir, { recursive: true });

      const transcriptPath = path.join(otherProjectDir, 'deadbeef-1234-5678-abcd-ef0123456789.jsonl');
      fs.writeFileSync(transcriptPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, transcriptPath);
    });

    it('should fall back to legacy transcript.jsonl in project dir', () => {
      // Create projects dir with legacy transcript.jsonl (no UUID files)
      const projectFolderName = process.cwd().replace(/[:\\/]/g, '-');
      const projectDir = path.join(tempDir, '.claude', 'projects', projectFolderName);
      fs.mkdirSync(projectDir, { recursive: true });

      const legacyPath = path.join(projectDir, 'transcript.jsonl');
      fs.writeFileSync(legacyPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, legacyPath);
    });

    it('should fall back to legacy ~/.claude/transcript.jsonl', () => {
      // Create .claude dir with legacy transcript.jsonl but no projects dir
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const legacyPath = path.join(claudeDir, 'transcript.jsonl');
      fs.writeFileSync(legacyPath, '{"type":"user"}\n');

      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, legacyPath);
    });

    it('should return null when no transcripts found', () => {
      // Don't create any transcripts
      const service = new SessionCaptureService();
      const result = service.findTranscript();

      assert.strictEqual(result, null);
    });

    it('should log warning when multiple candidates found', () => {
      const projectFolderName = process.cwd().replace(/[:\\/]/g, '-');
      const projectDir = path.join(tempDir, '.claude', 'projects', projectFolderName);
      fs.mkdirSync(projectDir, { recursive: true });

      fs.writeFileSync(path.join(projectDir, '11111111-1111-1111-1111-111111111111.jsonl'), '{"type":"user"}\n');
      fs.writeFileSync(path.join(projectDir, '22222222-2222-2222-2222-222222222222.jsonl'), '{"type":"user"}\n');

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

  describe('enricher integration', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-enricher-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    function createTranscriptFile(): string {
      const transcriptPath = path.join(tempDir, 'transcript.jsonl');
      const content = [
        '{"type":"user","message":{"role":"user","content":"Add caching"}}',
        '{"type":"assistant","message":{"role":"assistant","content":"I will add Redis caching."}}',
        '{"type":"tool_use","name":"edit"}',
        '{"type":"tool_result","result":"done"}',
        '{"type":"tool_use","name":"write"}',
        '{"type":"user","message":{"role":"user","content":"Good, now add tests"}}',
        '{"type":"assistant","message":{"role":"assistant","content":"Done, tests added."}}',
        '{"summary":"Created: src/cache.ts"}',
        '{"summary":"Modified: src/api.ts"}',
      ].join('\n');
      fs.writeFileSync(transcriptPath, content);
      return transcriptPath;
    }

    function createMockEnricher(result?: Partial<IEnrichmentResult>): ITranscriptEnricher & { calls: Array<{ workSummary: IWorkSummary; snippet: string }> } {
      const calls: Array<{ workSummary: IWorkSummary; snippet: string }> = [];
      const defaultResult: IEnrichmentResult = {
        facts: [
          {
            text: 'Redis caching added to the API',
            type: 'decision',
            confidence: 'high',
            tags: ['redis', 'caching'],
            rationale: 'Explicit decision',
          },
        ],
        summary: 'Added Redis caching layer.',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        ...result,
      };

      return {
        calls,
        async enrich(workSummary: IWorkSummary, snippet: string) {
          calls.push({ workSummary, snippet });
          return defaultResult;
        },
      };
    }

    it('should work without enricher (behavior unchanged)', async () => {
      const transcriptPath = createTranscriptFile();
      const service = new SessionCaptureService();

      const result = await service.captureSessionWork(undefined, transcriptPath);

      assert.ok(result.facts.length > 0);
      // No LLM-extracted facts should be present
      assert.ok(result.facts.every(f => !f.includes('source:llm-extracted')));
    });

    it('should append LLM-extracted facts when enricher is provided', async () => {
      const transcriptPath = createTranscriptFile();
      const enricher = createMockEnricher();
      const service = new SessionCaptureService(undefined, enricher);

      const result = await service.captureSessionWork(undefined, transcriptPath);

      // Should have both pattern-extracted and LLM-extracted facts
      const llmFacts = result.facts.filter(f => f.includes('source:llm-extracted'));
      assert.ok(llmFacts.length > 0, 'Should have LLM-extracted facts');
      assert.ok(llmFacts[0].includes('Redis caching added to the API'));
    });

    it('should tag LLM-extracted facts with source:llm-extracted', async () => {
      const transcriptPath = createTranscriptFile();
      const enricher = createMockEnricher();
      const service = new SessionCaptureService(undefined, enricher);

      const result = await service.captureSessionWork(undefined, transcriptPath);

      const llmFacts = result.facts.filter(f => f.includes('source:llm-extracted'));
      assert.ok(llmFacts.length >= 1);
      assert.ok(llmFacts[0].includes('source:llm-extracted'));
      assert.ok(llmFacts[0].includes('type:decision'));
      assert.ok(llmFacts[0].includes('confidence:high'));
    });

    it('should use LLM summary when available', async () => {
      const transcriptPath = createTranscriptFile();
      const enricher = createMockEnricher({ summary: 'LLM-generated session summary.' });
      const service = new SessionCaptureService(undefined, enricher);

      const result = await service.captureSessionWork(undefined, transcriptPath);

      assert.strictEqual(result.summary, 'LLM-generated session summary.');
    });

    it('should fall back to pattern summary when LLM summary is empty', async () => {
      const transcriptPath = createTranscriptFile();
      const enricher = createMockEnricher({ summary: '' });
      const service = new SessionCaptureService(undefined, enricher);

      const result = await service.captureSessionWork(undefined, transcriptPath);

      // Should use the pattern-extracted summary (last assistant message)
      assert.ok(result.summary !== undefined);
      assert.ok(result.summary !== '');
    });

    it('should gracefully fall back on enricher failure', async () => {
      const transcriptPath = createTranscriptFile();
      const failingEnricher: ITranscriptEnricher = {
        async enrich() {
          throw new Error('LLM provider unavailable');
        },
      };
      const service = new SessionCaptureService(undefined, failingEnricher);

      const result = await service.captureSessionWork(undefined, transcriptPath);

      // Should still have pattern-extracted facts
      assert.ok(result.facts.length > 0);
      // No LLM-extracted facts
      assert.ok(result.facts.every(f => !f.includes('source:llm-extracted')));
    });

    it('should pass work summary and transcript snippet to enricher', async () => {
      const transcriptPath = createTranscriptFile();
      const enricher = createMockEnricher();
      const service = new SessionCaptureService(undefined, enricher);

      await service.captureSessionWork(undefined, transcriptPath);

      assert.strictEqual(enricher.calls.length, 1);
      assert.ok(enricher.calls[0].workSummary.userPrompts >= 1);
      assert.ok(enricher.calls[0].snippet.length > 0);
      assert.ok(enricher.calls[0].snippet.includes('Add caching'));
    });
  });
});
