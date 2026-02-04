/**
 * CommitEnricher Tests.
 *
 * Tests LLM-based fact extraction from git commits:
 * prompt construction, JSON response parsing, fact validation,
 * batching, skip logic, type filtering, and graceful fallback.
 *
 * Part of LISA-8: Phase 2 Git-Powered Memory Enrichment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCommitEnricher } from '../../../../../../src/lib/infrastructure/services/CommitEnricher';
import type { ILlmGuard } from '../../../../../../src/lib/domain/interfaces/ILlmGuard';
import type { ILlmRequestOptions } from '../../../../../../src/lib/domain/interfaces/ILlmService';
import type { LlmFeature } from '../../../../../../src/lib/domain/interfaces/ILlmUsageTracker';
import type { IScoredCommit, IGitCommitData, IGitCommitStats, ICommitInterestSignals } from '../../../../../../src/lib/domain/interfaces/IGitTriageService';

// ── Mock data ──────────────────────────────────────────────

function createMockCommitData(overrides: Partial<IGitCommitData> = {}): IGitCommitData {
  return {
    sha: 'abc123def456789',
    shortSha: 'abc123d',
    subject: 'feat: add new feature',
    body: 'This commit adds a new feature to the system.',
    parentCount: 1,
    author: 'Test Author',
    authorEmail: 'test@example.com',
    timestamp: new Date('2026-01-15T10:00:00Z'),
    refs: [],
    ...overrides,
  };
}

function createMockStats(overrides: Partial<IGitCommitStats> = {}): IGitCommitStats {
  return {
    filesChanged: 5,
    insertions: 100,
    deletions: 20,
    filesAdded: ['src/new-file.ts'],
    filesDeleted: [],
    directoriesCreated: [],
    ...overrides,
  };
}

function createMockSignals(overrides: Partial<ICommitInterestSignals> = {}): ICommitInterestSignals {
  return {
    largeDiffFiles: false,
    largeDiffLines: false,
    mergeCommitWithPR: false,
    hasConventionalPrefix: true,
    conventionalType: 'feat',
    hasDecisionKeywords: false,
    createsNewDirectory: false,
    isTagAdjacent: false,
    hasLongMessageBody: false,
    prNumber: null,
    ...overrides,
  };
}

function createMockScoredCommit(overrides: Partial<{
  commit: Partial<IGitCommitData>;
  stats: Partial<IGitCommitStats> | null;
  signals: Partial<ICommitInterestSignals>;
  score: number;
  passedTriage: boolean;
}> = {}): IScoredCommit {
  return {
    commit: createMockCommitData(overrides.commit ?? {}),
    stats: overrides.stats === null ? null : createMockStats(overrides.stats ?? {}),
    signals: createMockSignals(overrides.signals ?? {}),
    score: overrides.score ?? 5,
    passedTriage: overrides.passedTriage ?? true,
  };
}

const mockCommits: IScoredCommit[] = [
  createMockScoredCommit({
    commit: { sha: 'sha1', shortSha: 'sha1', subject: 'feat: add caching layer' },
    signals: { hasConventionalPrefix: true, conventionalType: 'feat' },
  }),
  createMockScoredCommit({
    commit: { sha: 'sha2', shortSha: 'sha2', subject: 'fix: resolve memory leak' },
    signals: { hasConventionalPrefix: true, conventionalType: 'fix' },
  }),
];

// ── Mock LLM guard ─────────────────────────────────────────

interface IGuardCall { prompt: string; feature: LlmFeature; options?: ILlmRequestOptions }

function createMockLlmGuard(responseText?: string): ILlmGuard & { calls: IGuardCall[] } {
  const calls: IGuardCall[] = [];
  const text = responseText ?? JSON.stringify({
    facts: [
      {
        text: 'Added Redis caching layer to improve API performance',
        type: 'feature',
        confidence: 'high',
        tags: ['redis', 'caching', 'api'],
        commitSha: 'sha1',
        rationale: 'Significant new functionality evident from commit message',
      },
      {
        text: 'Fixed memory leak in connection pool by properly closing connections',
        type: 'bugfix',
        confidence: 'medium',
        tags: ['memory', 'connections'],
        commitSha: 'sha2',
        rationale: 'Bug fix with root cause identified',
      },
    ],
  });

  return {
    calls,
    async complete(prompt: string, feature: LlmFeature, options?: ILlmRequestOptions) {
      calls.push({ prompt, feature, options });
      return {
        text,
        usage: { inputTokens: 300, outputTokens: 150, totalTokens: 450 },
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic' as const,
      };
    },
    async isFeatureEnabled() { return true; },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('CommitEnricher', () => {
  describe('enrich()', () => {
    it('should call LLM with extraction feature', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits);

      assert.strictEqual(guard.calls.length, 1);
      assert.strictEqual(guard.calls[0]?.feature, 'extraction');
    });

    it('should include system prompt in LLM call', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits);

      assert.strictEqual(guard.calls.length, 1);
      assert.ok(guard.calls[0]?.options?.systemPrompt);
      assert.ok(guard.calls[0]?.options?.systemPrompt.includes('git commits'));
    });

    it('should include commit context in prompt', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits);

      const prompt = guard.calls[0]?.prompt ?? '';
      assert.ok(prompt.includes('sha1'));
      assert.ok(prompt.includes('add caching layer'));
      assert.ok(prompt.includes('sha2'));
      assert.ok(prompt.includes('resolve memory leak'));
    });

    it('should parse JSON response into ICommitFact array', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 2);
      assert.strictEqual(result.facts[0]?.text, 'Added Redis caching layer to improve API performance');
      assert.strictEqual(result.facts[0]?.type, 'feature');
      assert.strictEqual(result.facts[0]?.confidence, 'high');
      assert.strictEqual(result.facts[0]?.commitSha, 'sha1');
      assert.ok(result.facts[0]?.tags.includes('redis'));
    });

    it('should return usage stats from LLM response', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.usage.inputTokens, 300);
      assert.strictEqual(result.usage.outputTokens, 150);
      assert.strictEqual(result.usage.totalTokens, 450);
    });

    it('should return commitsProcessed and commitsSkipped counts', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.commitsProcessed, 2);
      assert.strictEqual(result.commitsSkipped, 0);
    });

    it('should respect maxCommits option', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const manyCommits = [
        ...mockCommits,
        createMockScoredCommit({ commit: { sha: 'sha3', shortSha: 'sha3' } }),
        createMockScoredCommit({ commit: { sha: 'sha4', shortSha: 'sha4' } }),
        createMockScoredCommit({ commit: { sha: 'sha5', shortSha: 'sha5' } }),
      ];

      const result = await enricher.enrich(manyCommits, { maxCommits: 2 });

      assert.strictEqual(result.commitsProcessed, 2);
      assert.strictEqual(result.commitsSkipped, 3);
    });

    it('should skip commits in skipShas list', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits, { skipShas: ['sha1'] });

      assert.strictEqual(result.commitsProcessed, 1);
      assert.strictEqual(result.commitsSkipped, 1);
      const prompt = guard.calls[0]?.prompt ?? '';
      assert.ok(!prompt.includes('sha1'));
      assert.ok(prompt.includes('sha2'));
    });

    it('should return empty result when all commits are skipped', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits, { skipShas: ['sha1', 'sha2'] });

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.commitsProcessed, 0);
      assert.strictEqual(result.commitsSkipped, 2);
      assert.strictEqual(guard.calls.length, 0); // No LLM call made
    });

    it('should return empty result when maxCommits is zero', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits, { maxCommits: 0 });

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.commitsProcessed, 0);
      assert.strictEqual(result.commitsSkipped, 2);
      assert.strictEqual(guard.calls.length, 0); // No LLM call made
    });

    it('should return empty result when maxCommits is negative', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits, { maxCommits: -5 });

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.commitsProcessed, 0);
      assert.strictEqual(result.commitsSkipped, 2);
      assert.strictEqual(guard.calls.length, 0); // No LLM call made
    });

    it('should reject facts with unknown commitSha (hallucinated by LLM)', async () => {
      const responseWithHallucinatedSha = JSON.stringify({
        facts: [
          { text: 'Valid fact', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' },
          { text: 'Hallucinated SHA', type: 'decision', confidence: 'high', tags: [], commitSha: 'unknown-sha' },
        ],
      });
      const guard = createMockLlmGuard(responseWithHallucinatedSha);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.commitSha, 'sha1');
    });

    it('should filter by extractTypes when provided', async () => {
      const responseWithMixed = JSON.stringify({
        facts: [
          { text: 'A feature', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' },
          { text: 'A refactor', type: 'refactor', confidence: 'medium', tags: [], commitSha: 'sha1' },
          { text: 'A bugfix', type: 'bugfix', confidence: 'high', tags: [], commitSha: 'sha2' },
        ],
      });
      const guard = createMockLlmGuard(responseWithMixed);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits, {
        extractTypes: ['feature', 'bugfix'],
      });

      assert.strictEqual(result.facts.length, 2);
      assert.ok(result.facts.every(f => f.type === 'feature' || f.type === 'bugfix'));
    });

    it('should reject facts with unknown types', async () => {
      const responseWithBadType = JSON.stringify({
        facts: [
          { text: 'Valid fact', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' },
          { text: 'Invalid fact', type: 'unknown-type', confidence: 'high', tags: [], commitSha: 'sha2' },
        ],
      });
      const guard = createMockLlmGuard(responseWithBadType);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.type, 'feature');
    });

    it('should reject facts with empty text', async () => {
      const responseWithEmptyText = JSON.stringify({
        facts: [
          { text: '', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' },
          { text: '   ', type: 'bugfix', confidence: 'medium', tags: [], commitSha: 'sha2' },
          { text: 'Valid', type: 'decision', confidence: 'high', tags: [], commitSha: 'sha1' },
        ],
      });
      const guard = createMockLlmGuard(responseWithEmptyText);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.text, 'Valid');
    });

    it('should reject facts with missing commitSha', async () => {
      const responseWithoutSha = JSON.stringify({
        facts: [
          { text: 'Fact without SHA', type: 'feature', confidence: 'high', tags: [] },
          { text: 'Fact with SHA', type: 'decision', confidence: 'high', tags: [], commitSha: 'sha1' },
        ],
      });
      const guard = createMockLlmGuard(responseWithoutSha);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.commitSha, 'sha1');
    });

    it('should default confidence to medium for invalid values', async () => {
      const responseWithBadConfidence = JSON.stringify({
        facts: [
          { text: 'Fact with bad confidence', type: 'feature', confidence: 'super-high', tags: [], commitSha: 'sha1' },
        ],
      });
      const guard = createMockLlmGuard(responseWithBadConfidence);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.confidence, 'medium');
    });

    it('should default confidence to medium when missing', async () => {
      const responseWithoutConfidence = JSON.stringify({
        facts: [
          { text: 'Fact without confidence', type: 'feature', tags: [], commitSha: 'sha1' },
        ],
      });
      const guard = createMockLlmGuard(responseWithoutConfidence);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.confidence, 'medium');
    });

    it('should handle valid confidence levels correctly', async () => {
      const responseWithConfidences = JSON.stringify({
        facts: [
          { text: 'High conf', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' },
          { text: 'Low conf', type: 'bugfix', confidence: 'low', tags: [], commitSha: 'sha2' },
        ],
      });
      const guard = createMockLlmGuard(responseWithConfidences);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

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
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.commitsProcessed, 0);
      assert.strictEqual(result.commitsSkipped, 2);
      assert.strictEqual(result.usage.inputTokens, 0);
    });

    it('should handle malformed JSON response gracefully', async () => {
      const guard = createMockLlmGuard('This is not JSON at all');
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 0);
    });

    it('should handle JSON with extra text before/after', async () => {
      const jsonWithWrapper = 'Here is the analysis:\n' + JSON.stringify({
        facts: [{ text: 'A fact', type: 'feature', confidence: 'high', tags: [], commitSha: 'sha1' }],
      }) + '\n\nHope that helps!';
      const guard = createMockLlmGuard(jsonWithWrapper);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 1);
      assert.strictEqual(result.facts[0]?.text, 'A fact');
    });

    it('should handle response with empty facts array', async () => {
      const emptyResponse = JSON.stringify({ facts: [] });
      const guard = createMockLlmGuard(emptyResponse);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts.length, 0);
    });

    it('should strip whitespace from fact text and tags', async () => {
      const response = JSON.stringify({
        facts: [
          { text: '  Padded fact  ', type: 'feature', confidence: 'high', tags: ['  tag1  ', ' tag2 '], commitSha: 'sha1' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts[0]?.text, 'Padded fact');
      assert.deepStrictEqual([...result.facts[0]?.tags ?? []], ['tag1', 'tag2']);
    });

    it('should include rationale when present', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts[0]?.rationale, 'Significant new functionality evident from commit message');
    });

    it('should omit rationale when empty', async () => {
      const response = JSON.stringify({
        facts: [
          { text: 'Fact', type: 'feature', confidence: 'medium', tags: [], commitSha: 'sha1', rationale: '' },
        ],
      });
      const guard = createMockLlmGuard(response);
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich(mockCommits);

      assert.strictEqual(result.facts[0]?.rationale, undefined);
    });

    it('should include extractTypes in system prompt when specified', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits, {
        extractTypes: ['feature', 'breaking-change'],
      });

      const systemPrompt = guard.calls[0]?.options?.systemPrompt ?? '';
      assert.ok(systemPrompt.includes('feature, breaking-change'));
    });

    it('should use low temperature for deterministic extraction', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits);

      assert.strictEqual(guard.calls[0]?.options?.temperature, 0.3);
    });

    it('should respect maxTokens option', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits, { maxTokens: 2048 });

      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 2048);
    });

    it('should use default maxTokens when not specified', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      await enricher.enrich(mockCommits);

      assert.strictEqual(guard.calls[0]?.options?.maxTokens, 4096);
    });

    it('should return empty result for empty commit list', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const result = await enricher.enrich([]);

      assert.strictEqual(result.facts.length, 0);
      assert.strictEqual(result.commitsProcessed, 0);
      assert.strictEqual(result.commitsSkipped, 0);
      assert.strictEqual(guard.calls.length, 0);
    });

    it('should include interest signals in prompt', async () => {
      const guard = createMockLlmGuard();
      const enricher = createCommitEnricher(guard);

      const commits = [
        createMockScoredCommit({
          commit: { sha: 'sha1', shortSha: 'sha1' },
          signals: {
            mergeCommitWithPR: true,
            prNumber: 123,
            hasDecisionKeywords: true,
            createsNewDirectory: true,
          },
        }),
      ];

      await enricher.enrich(commits);

      const prompt = guard.calls[0]?.prompt ?? '';
      assert.ok(prompt.includes('merge-PR-#123'));
      assert.ok(prompt.includes('decision-keywords'));
      assert.ok(prompt.includes('new-directory'));
    });
  });
});
