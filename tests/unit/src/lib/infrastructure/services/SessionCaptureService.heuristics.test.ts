/**
 * Tests for SessionCaptureService heuristic detection methods.
 *
 * Tests the 4 heuristic detectors introduced in #179:
 * - Decision detection (user confirmation patterns)
 * - Error detection (stack traces, tool failures, retry patterns)
 * - File-prompt correlation
 * - Task type detection (keyword-based scoring)
 *
 * Also tests that buildFacts() emits heuristic-tagged facts and
 * captureSessionWork() includes the `work` field.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionCaptureService } from '../../../../../../src/lib/infrastructure/services/SessionCaptureService';

describe('SessionCaptureService — heuristic detections (#179)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-heuristics-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper: write transcript lines and return path.
   */
  function writeTranscript(lines: string[]): string {
    const p = path.join(tempDir, 'transcript.jsonl');
    fs.writeFileSync(p, lines.join('\n'));
    return p;
  }

  /**
   * Helper: build a user message JSON line.
   */
  function userMsg(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  /**
   * Helper: build an assistant message JSON line.
   */
  function assistantMsg(text: string): string {
    return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: text } });
  }

  /**
   * Helper: build a tool_use message JSON line.
   */
  function toolUse(name: string): string {
    return JSON.stringify({ type: 'tool_use', message: { content: [{ type: 'tool_use', name }] } });
  }

  /**
   * Helper: build a tool_result message JSON line.
   */
  function toolResult(text: string, isError = false): string {
    return JSON.stringify({
      type: 'tool_result',
      message: { content: [{ type: 'tool_result', text, is_error: isError }] },
    });
  }

  /**
   * Helper: build a summary message JSON line.
   */
  function summaryMsg(summary: string): string {
    return JSON.stringify({ summary });
  }

  // ============================================================
  // Decision Detection
  // ============================================================

  describe('decision detection', () => {
    it('should detect a user confirmation after assistant options', () => {
      const tp = writeTranscript([
        userMsg('How should we handle authentication?'),
        assistantMsg('We have two options: Option A uses JWT tokens, or we could use session cookies. I recommend JWT.'),
        userMsg('Yes, let\'s go with JWT'),
        assistantMsg('Great, I will implement JWT authentication.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedDecisions, 'Should have detectedDecisions');
      assert.ok(work.detectedDecisions.length >= 1, 'Should detect at least 1 decision');
      assert.ok(work.detectedDecisions[0].confidence > 0, 'Should have positive confidence');
      assert.ok(work.detectedDecisions[0].userMessage.length > 0, 'Should capture user message');
    });

    it('should not detect decision when user does not confirm', () => {
      const tp = writeTranscript([
        userMsg('How should we handle authentication?'),
        assistantMsg('We have two options: Option A or Option B.'),
        userMsg('Actually, tell me more about option B'),
        assistantMsg('Option B uses session cookies.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      // "tell me more" doesn't match confirmation pattern
      assert.ok(!work.detectedDecisions || work.detectedDecisions.length === 0);
    });

    it('should cap decisions at MAX_DECISIONS (3)', () => {
      const tp = writeTranscript([
        assistantMsg('Should we use approach A? I suggest approach A.'),
        userMsg('Yes'),
        assistantMsg('Should we use approach B? I recommend approach B.'),
        userMsg('Ok'),
        assistantMsg('Should we use approach C? Either approach C or D.'),
        userMsg('Sounds good'),
        assistantMsg('Should we use approach D? I suggest approach D.'),
        userMsg('Agreed'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedDecisions);
      assert.ok(work.detectedDecisions.length <= 3, `Expected max 3 decisions, got ${work.detectedDecisions.length}`);
    });

    it('should detect various confirmation patterns', () => {
      const confirmations = ['yes', 'ok', 'sounds good', 'go ahead', 'approved', 'do that'];

      for (const confirmation of confirmations) {
        const tp = writeTranscript([
          assistantMsg('I suggest we use this approach. We could also try an alternative.'),
          userMsg(confirmation),
        ]);

        const service = new SessionCaptureService();
        const work = service.parseTranscript(tp);

        assert.ok(
          work.detectedDecisions && work.detectedDecisions.length >= 1,
          `Should detect decision for confirmation: "${confirmation}"`
        );
      }
    });
  });

  // ============================================================
  // Error Detection
  // ============================================================

  describe('error detection', () => {
    it('should detect stack traces', () => {
      const tp = writeTranscript([
        userMsg('Run the tests'),
        assistantMsg('Running tests...'),
        assistantMsg('TypeError: Cannot read property "foo" of undefined\n    at Object.<anonymous> (test.ts:5:10)\n    at Module._compile (node:internal)'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedErrors, 'Should have detectedErrors');
      assert.ok(work.detectedErrors.length >= 1, 'Should detect at least 1 error');
      assert.strictEqual(work.detectedErrors[0].errorType, 'stack-trace');
    });

    it('should detect Error: type patterns', () => {
      const tp = writeTranscript([
        userMsg('Build the project'),
        assistantMsg('SyntaxError: Unexpected token at line 42'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedErrors);
      assert.ok(work.detectedErrors.length >= 1);
      assert.ok(work.detectedErrors[0].text.includes('SyntaxError'));
    });

    it('should detect tool failures', () => {
      const tp = writeTranscript([
        userMsg('Edit the file'),
        toolUse('edit'),
        toolResult('Permission denied: cannot write to file', true),
        assistantMsg('The edit failed.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedErrors);
      const toolFailure = work.detectedErrors.find(e => e.errorType === 'tool-failure');
      assert.ok(toolFailure, 'Should detect tool failure');
      assert.ok(toolFailure.text.includes('Tool failure'));
    });

    it('should detect retry patterns (same tool >2 times consecutively)', () => {
      const tp = writeTranscript([
        userMsg('Fix the file'),
        toolUse('edit'),
        toolResult('done'),
        toolUse('edit'),
        toolResult('done'),
        toolUse('edit'),
        toolResult('done'),
        assistantMsg('Finally got it to work.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedErrors);
      const retryError = work.detectedErrors.find(e => e.errorType === 'retry-pattern');
      assert.ok(retryError, 'Should detect retry pattern');
      assert.ok(retryError.text.includes('edit'));
    });

    it('should cap errors at MAX_ERRORS (2)', () => {
      const tp = writeTranscript([
        userMsg('Run everything'),
        assistantMsg('TypeError: err1\n    at foo (a.ts:1:1)'),
        assistantMsg('RangeError: err2\n    at bar (b.ts:2:2)'),
        assistantMsg('ReferenceError: err3\n    at baz (c.ts:3:3)'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.detectedErrors);
      assert.ok(work.detectedErrors.length <= 2, `Expected max 2 errors, got ${work.detectedErrors.length}`);
    });

    it('should not detect errors when messages are clean', () => {
      const tp = writeTranscript([
        userMsg('Create a new file'),
        assistantMsg('I created the file successfully.'),
        toolUse('write'),
        toolResult('Success'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(!work.detectedErrors || work.detectedErrors.length === 0);
    });
  });

  // ============================================================
  // File-Prompt Correlation
  // ============================================================

  describe('file-prompt correlation', () => {
    it('should correlate file changes with user prompts mentioning the file', () => {
      const tp = writeTranscript([
        userMsg('Please update the SessionCaptureService.ts file'),
        assistantMsg('I will update it now.'),
        toolUse('edit'),
        toolResult('done'),
        summaryMsg('Modified: src/SessionCaptureService.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.filePromptCorrelations, 'Should have filePromptCorrelations');
      assert.ok(work.filePromptCorrelations.length >= 1);
      assert.ok(work.filePromptCorrelations[0].filePath.includes('SessionCaptureService.ts'));
      assert.ok(work.filePromptCorrelations[0].triggerSnippet.includes('SessionCaptureService'));
    });

    it('should match by filename without extension', () => {
      const tp = writeTranscript([
        userMsg('Refactor the OrderService module'),
        assistantMsg('Refactoring now.'),
        summaryMsg('Modified: src/OrderService.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.filePromptCorrelations);
      assert.ok(work.filePromptCorrelations.length >= 1);
      assert.ok(work.filePromptCorrelations[0].filePath.includes('OrderService'));
    });

    it('should not correlate files not mentioned in user prompts', () => {
      const tp = writeTranscript([
        userMsg('Make the app faster'),
        assistantMsg('I will optimize the code.'),
        summaryMsg('Modified: src/internal-helper.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(!work.filePromptCorrelations || work.filePromptCorrelations.length === 0);
    });

    it('should cap correlations at MAX_CORRELATIONS (3)', () => {
      const tp = writeTranscript([
        userMsg('Update FileA.ts, FileB.ts, FileC.ts, and FileD.ts'),
        assistantMsg('I will update all of them.'),
        summaryMsg('Modified: src/FileA.ts'),
        summaryMsg('Modified: src/FileB.ts'),
        summaryMsg('Modified: src/FileC.ts'),
        summaryMsg('Modified: src/FileD.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(work.filePromptCorrelations);
      assert.ok(
        work.filePromptCorrelations.length <= 3,
        `Expected max 3 correlations, got ${work.filePromptCorrelations.length}`
      );
    });
  });

  // ============================================================
  // Task Type Detection
  // ============================================================

  describe('task type detection', () => {
    it('should detect planning task type from planning keywords', () => {
      const tp = writeTranscript([
        userMsg('Let me design the architecture for the new module'),
        userMsg('What approach should we take? Let me evaluate the alternatives'),
        assistantMsg('Here are the options to consider...'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.strictEqual(work.detectedTaskType, 'planning');
    });

    it('should detect execution task type from execution keywords', () => {
      const tp = writeTranscript([
        userMsg('Implement the user authentication feature'),
        userMsg('Create the login component and add it to the app'),
        assistantMsg('I will build that now.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.strictEqual(work.detectedTaskType, 'execution');
    });

    it('should detect debugging task type from debugging keywords', () => {
      const tp = writeTranscript([
        userMsg('There is a bug in the login flow'),
        userMsg('The tests are failing and I see an error in the console'),
        assistantMsg('Let me debug that.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.strictEqual(work.detectedTaskType, 'debugging');
    });

    it('should detect exploration task type from exploration keywords', () => {
      const tp = writeTranscript([
        userMsg('What if we used a different database? Let me explore the options'),
        userMsg('I want to investigate how the caching works'),
        assistantMsg('Let me look into that.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.strictEqual(work.detectedTaskType, 'exploration');
    });

    it('should return undefined when no task type signals found', () => {
      const tp = writeTranscript([
        userMsg('Hello'),
        assistantMsg('Hi there, how can I help?'),
        userMsg('Thanks'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.strictEqual(work.detectedTaskType, undefined);
    });

    it('should pick the dominant task type by highest keyword score', () => {
      // Mix of signals, but more execution keywords
      const tp = writeTranscript([
        userMsg('I need to implement the feature'),
        userMsg('Create the files and build the component'),
        userMsg('Also update the configuration'),
        userMsg('We should consider the design briefly'),
        assistantMsg('Starting implementation.'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      // execution has: implement, create, build, update = 4 signals
      // planning has: consider, design = 2 signals
      assert.strictEqual(work.detectedTaskType, 'execution');
    });
  });

  // ============================================================
  // buildFacts — heuristic fact generation
  // ============================================================

  describe('buildFacts with heuristic detections', () => {
    it('should emit DECISION: facts with quality tags', () => {
      const tp = writeTranscript([
        assistantMsg('I suggest we use Redis for caching. We could also use Memcached as an alternative.'),
        userMsg('Yes, go with Redis'),
        assistantMsg('Implementing Redis caching.'),
        toolUse('write'),
        toolResult('done'),
        summaryMsg('Created: src/cache.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);
      const facts = service.buildFacts(work);

      const decisionFacts = facts.filter(f => f.startsWith('DECISION:'));
      assert.ok(decisionFacts.length >= 1, 'Should have at least 1 DECISION fact');
      assert.ok(decisionFacts[0].includes('source:session-capture'));
      assert.ok(decisionFacts[0].includes('confidence:medium'));
      assert.ok(decisionFacts[0].includes('type:decision'));
    });

    it('should emit ERROR: facts with quality tags', () => {
      const tp = writeTranscript([
        userMsg('Run the tests'),
        assistantMsg('TypeError: Cannot read properties of null\n    at test.ts:10:5'),
        assistantMsg('I will fix this error.'),
        toolUse('edit'),
        toolResult('done'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);
      const facts = service.buildFacts(work);

      const errorFacts = facts.filter(f => f.startsWith('ERROR:'));
      assert.ok(errorFacts.length >= 1, 'Should have at least 1 ERROR fact');
      assert.ok(errorFacts[0].includes('source:session-capture'));
      assert.ok(errorFacts[0].includes('confidence:medium'));
      assert.ok(errorFacts[0].includes('type:error'));
    });

    it('should emit FILE-CONTEXT: facts with quality tags and file tag', () => {
      const tp = writeTranscript([
        userMsg('Update the UserService file'),
        assistantMsg('I will update it.'),
        toolUse('edit'),
        toolResult('done'),
        summaryMsg('Modified: src/UserService.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);
      const facts = service.buildFacts(work);

      const fileFacts = facts.filter(f => f.startsWith('FILE-CONTEXT:'));
      assert.ok(fileFacts.length >= 1, 'Should have at least 1 FILE-CONTEXT fact');
      assert.ok(fileFacts[0].includes('source:session-capture'));
      assert.ok(fileFacts[0].includes('confidence:medium'));
      assert.ok(fileFacts[0].includes('type:correlation'));
      assert.ok(fileFacts[0].includes('file:src/UserService.ts'));
    });

    it('should not correlate when file mention is outside the 3-message window', () => {
      const tp = writeTranscript([
        userMsg('Update the UserService file'),
        assistantMsg('Got it.'),
        toolUse('edit'),
        toolResult('done'),
        assistantMsg('All set.'),
        summaryMsg('Modified: src/UserService.ts'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);

      assert.ok(!work.filePromptCorrelations || work.filePromptCorrelations.length === 0);
    });

    it('should not emit heuristic facts when no heuristics triggered', () => {
      const tp = writeTranscript([
        userMsg('Hello'),
        assistantMsg('Hi there! How can I help you today?'),
        userMsg('What is the weather?'),
        assistantMsg('I cannot check the weather, but I can help with coding.'),
        toolUse('read'),
        toolResult('file contents'),
      ]);

      const service = new SessionCaptureService();
      const work = service.parseTranscript(tp);
      const facts = service.buildFacts(work);

      const heuristicFacts = facts.filter(
        f => f.startsWith('DECISION:') || f.startsWith('ERROR:') || f.startsWith('FILE-CONTEXT:')
      );
      assert.strictEqual(heuristicFacts.length, 0, 'Should have no heuristic facts');
    });
  });

  // ============================================================
  // captureSessionWork — end-to-end with `work` field
  // ============================================================

  describe('captureSessionWork includes work field', () => {
    it('should include work field with heuristic detections', async () => {
      const tp = writeTranscript([
        userMsg('Implement the caching layer'),
        assistantMsg('I suggest Redis. We could also use an alternative like Memcached.'),
        userMsg('Go ahead with Redis'),
        assistantMsg('Implementing Redis caching now.'),
        toolUse('write'),
        toolResult('done'),
        toolUse('edit'),
        toolResult('done'),
        summaryMsg('Created: src/cache.ts'),
        summaryMsg('Modified: src/api.ts'),
      ]);

      const service = new SessionCaptureService();
      const result = await service.captureSessionWork(undefined, tp);

      assert.ok(result.work, 'Should include work field');
      assert.ok(result.work.messageCount > 0);
      assert.ok(result.work.userPrompts > 0);
      assert.ok(result.work.filesCreated.length > 0 || result.work.filesModified.length > 0);
    });

    it('should include detectedTaskType in work field', async () => {
      const tp = writeTranscript([
        userMsg('Debug the failing test'),
        userMsg('There is a bug causing the error'),
        assistantMsg('Let me investigate.'),
        toolUse('read'),
        toolResult('code content'),
        toolUse('edit'),
        toolResult('done'),
      ]);

      const service = new SessionCaptureService();
      const result = await service.captureSessionWork(undefined, tp);

      assert.ok(result.work, 'Should include work field');
      assert.strictEqual(result.work.detectedTaskType, 'debugging');
    });

    it('should not include work field when no significant work', async () => {
      const tp = writeTranscript([
        userMsg('Hi'),
        assistantMsg('Hello'),
      ]);

      const service = new SessionCaptureService();
      const result = await service.captureSessionWork(undefined, tp);

      // emptyCapturedWork() does not include work field
      assert.strictEqual(result.work, undefined);
    });
  });
});
