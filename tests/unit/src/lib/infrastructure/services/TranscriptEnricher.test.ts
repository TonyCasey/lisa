/**
 * TranscriptEnricher Tests.
 *
 * Tests LLM-based fact extraction from session transcripts:
 * prompt construction, JSON response parsing, fact validation,
 * truncation, depth modes, type filtering, and graceful fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTranscriptEnricher } from '../../../../../../src/lib/infrastructure/services/TranscriptEnricher';
import type { ILlmGuard } from '../../../../../../src/lib/domain/interfaces/ILlmGuard';
import type { ILlmRequestOptions } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { LlmFeature } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';
import type { IWorkSummary } from '../../../../../../src/lib/infrastructure/services/SessionCaptureService';

// ── Mock data ──────────────────────────────────────────────

const mockWorkSummary: IWorkSummary = {
  messageCount: 20,
  userPrompts: 8,
  assistantResponses: 8,
  toolCalls: 12,
  filesCreated: ['src/new-file.ts'],
  filesModified: ['src/existing.ts', 'package.json'],
  duration: 0,
  summary: 'Implemented new feature with tests',
};

const mockTranscript = [
  '[user] Please add a caching layer to the API',
  '[assistant] I will add Redis caching to the API endpoints.',
  '[user] Use LRU eviction strategy',
  '[assistant] Done. I added LRU cache with 1000 max entries.',
].join('\n\n');

// ── Mock LLM guard ─────────────────────────────────────────

interface IGuardCall { prompt: string; feature: LlmFeature; options?: ILlmRequestOptions }

function createMockLlmGuard(responseText?: string): ILlmGuard & { calls: IGuardCall[] } {
  const calls: IGuardCall[] = [];
  const text = responseText ?? JSON.stringify({
    facts: [
      {
        text: 'API uses Redis with LRU eviction strategy for caching',
        type: 'decision',
        confidence: 'high',
        tags: ['redis', 'caching', 'api'],
        rationale: 'Explicit decision made during session',
      },
      {
        text: 'LRU cache configured with 1000 max entries',
        type: 'convention',
        confidence: 'medium',
        tags: ['caching', 'config'],
        rationale: 'Configuration detail worth remembering',
      },
    ],
    summary: 'Added Redis caching with LRU eviction to the API.',
  });

  return {
    calls,
    async complete(prompt: string, feature: LlmFeature, options?: ILlmRequestOptions) {
      calls.push({ prompt, feature, options });
      return {
        text,
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic' as const,
      };
    },
    async isFeatureEnabled() { return true; },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('TranscriptEnricher', () => {
  describe('enrich()', () => {
    it('should call LLM with extraction feature', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.feature, 'extraction');
    });

    it('should include system prompt in LLM call', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(guard.calls.length, 1);
      assert.ok(guard.calls[0]?.options?.systemPrompt);
      assert.ok(guard.calls[0]?.options?.systemPrompt.includes('coding session transcript'));
    });

    it('should include work summary context in prompt', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript);

      const prompt = guard.calls[0]?.prompt ?? '';
      assert.ok(prompt.includes('User prompts: 8'));
      assert.ok(prompt.includes('src/new-file.ts'));
      assert.ok(prompt.includes('src/existing.ts'));
    });

    it('should parse JSON response into IExtractedFact array', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 2);
      assert.strictEqual(result.facts[0]?.text, 'API uses Redis with LRU eviction strategy for caching');
      assert.strictEqual(result.facts[0]?.type, 'decision');
      assert.strictEqual(result.facts[0]?.confidence, 'high');
      assert.ok(result.facts[0]?.tags.includes('redis'));
    });

    it('should return summary from LLM response', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.summary, 'Added Redis caching with LRU eviction to the API.');
    });

    it('should return usage stats from LLM response', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.usage.inputTokens, 200);
      assert.strictEqual(result.usage.outputTokens, 100);
      assert.strictEqual(result.usage.totalTokens, 300);
    });

    it('should truncate transcript to maxSnippetLength', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      const longTranscript = 'x'.repeat(10000);
      await enricher.enrich(mockWorkSummary, longTranscript, { maxSnippetLength: 100 });

      const prompt = guard.calls[0]?.prompt ?? '';
      // The transcript section should be truncated
      assert.ok(prompt.length < 10000);
    });

    it('should use higher maxTokens for thorough depth', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript, { depth: 'thorough' });

      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 4096);
    });

    it('should use lower maxTokens for fast depth', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript, { depth: 'fast' });

      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 2048);
    });

    it('should filter by extractTypes when provided', async () => {
      const responseWithMixed = JSON.stringify({
        facts: [
          { text: 'A decision', type: 'decision', confidence: 'high', tags: [] },
          { text: 'A learning', type: 'learning', confidence: 'medium', tags: [] },
          { text: 'A blocker', type: 'blocker', confidence: 'low', tags: [] },
        ],
        summary: 'Mixed session.',
      });
      const guard = createMockLlmGuard(responseWithMixed);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript, {
        extractTypes: ['decision', 'blocker'],
      });

      assert.strictEqual(result.facts.length, 2);
      assert.ok(result.facts.every(f => f.type === 'decision' || f.type === 'blocker'));
    });

    it('should reject facts with unknown types', async () => {
      const responseWithBadType = JSON.stringify({
        facts: [
          { text: 'Valid fact', type: 'decision', confidence: 'high', tags: [] },
          { text: 'Invalid fact', type: 'fantasy', confidence: 'high', tags: [] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(responseWithBadType);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.type, 'decision');
    });

    it('should reject facts with empty text', async () => {
      const responseWithEmptyText = JSON.stringify({
        facts: [
          { text: '', type: 'decision', confidence: 'high', tags: [] },
          { text: '   ', type: 'learning', confidence: 'medium', tags: [] },
          { text: 'Valid', type: 'convention', confidence: 'high', tags: [] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(responseWithEmptyText);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.text, 'Valid');
    });

    it('should default confidence to medium for invalid values', async () => {
      const responseWithBadConfidence = JSON.stringify({
        facts: [
          { text: 'Fact with bad confidence', type: 'decision', confidence: 'super-high', tags: [] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(responseWithBadConfidence);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.confidence, 'medium');
    });

    it('should default confidence to medium when missing', async () => {
      const responseWithoutConfidence = JSON.stringify({
        facts: [
          { text: 'Fact without confidence', type: 'learning', tags: ['test'] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(responseWithoutConfidence);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.confidence, 'medium');
    });

    it('should handle valid confidence levels correctly', async () => {
      const responseWithConfidences = JSON.stringify({
        facts: [
          { text: 'High conf', type: 'decision', confidence: 'high', tags: [] },
          { text: 'Low conf', type: 'learning', confidence: 'low', tags: [] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(responseWithConfidences);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts[0]?.confidence, 'high');
      assert.strictEqual(result.facts[1]?.confidence, 'low');
    });

    it('should return empty result on LLM failure', async () => {
      const guard: ILlmGuard = {
        async complete() {
          throw new Error('LLM provider unavailable');
        },
        async isFeatureEnabled() { return true; },
      };
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.summary, '');
      assert.strictEqual(result.usage.inputTokens, 0);
    });

    it('should handle malformed JSON response gracefully', async () => {
      const guard = createMockLlmGuard('This is not JSON at all');
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.summary, '');
    });

    it('should handle JSON with extra text before/after', async () => {
      const jsonWithWrapper = 'Here is the analysis:\n' + JSON.stringify({
        facts: [{ text: 'A fact', type: 'decision', confidence: 'high', tags: [] }],
        summary: 'Session summary.',
      }) + '\n\nHope that helps!';
      const guard = createMockLlmGuard(jsonWithWrapper);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.text, 'A fact');
      assert.strictEqual(result.summary, 'Session summary.');
    });

    it('should handle response with empty facts array', async () => {
      const emptyResponse = JSON.stringify({ facts: [], summary: 'Nothing notable.' });
      const guard = createMockLlmGuard(emptyResponse);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.summary, 'Nothing notable.');
    });

    it('should strip whitespace from fact text and tags', async () => {
      const response = JSON.stringify({
        facts: [
          { text: '  Padded fact  ', type: 'decision', confidence: 'high', tags: ['  tag1  ', ' tag2 '] },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(response);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts[0]?.text, 'Padded fact');
      assert.deepStrictEqual([...result.facts[0]?.tags ?? []], ['tag1', 'tag2']);
    });

    it('should include rationale when present', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts[0]?.rationale, 'Explicit decision made during session');
    });

    it('should omit rationale when empty', async () => {
      const response = JSON.stringify({
        facts: [
          { text: 'Fact', type: 'learning', confidence: 'medium', tags: [], rationale: '' },
        ],
        summary: 'Test.',
      });
      const guard = createMockLlmGuard(response);
      const enricher = createTranscriptEnricher(guard);

      const result = await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(result.facts[0]?.rationale, undefined);
    });

    it('should include extractTypes in system prompt when specified', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript, {
        extractTypes: ['decision', 'gotcha'],
      });

      const systemPrompt = guard.calls[0]?.options?.systemPrompt ?? '';
      assert.ok(systemPrompt.includes('decision, gotcha'));
    });

    it('should use low temperature for deterministic extraction', async () => {
      const guard = createMockLlmGuard();
      const enricher = createTranscriptEnricher(guard);

      await enricher.enrich(mockWorkSummary, mockTranscript);

      assert.strictEqual(guard.calls[0]?.options?.temperature, 0.3);
    });
  });
});
