import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createRepoProfileService,
  renderMarkdown,
  calculateFreshness,
} from '../../../../../../src/lib/application/services/RepoProfileService';
import type { IFileSystem } from '../../../../../../src/lib/domain/interfaces/IFileSystem';
import type { ILogger } from '../../../../../../src/lib/domain/interfaces/ILogger';
import type { IProfileInput, IProfileGenerateOptions } from '../../../../../../src/lib/domain/interfaces/IRepoProfileService';
import type { ITriageResult, IFileHotspot, ITagInfo, IGitCommitData } from '../../../../../../src/lib/domain/interfaces/IGitTriageService';
import type { IHeuristicExtractionResult, IHeuristicFact } from '../../../../../../src/lib/domain/interfaces/IGitExtractor';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockCommit(overrides: Partial<IGitCommitData> = {}): IGitCommitData {
  return {
    sha: 'abc1234567890',
    shortSha: 'abc1234',
    subject: 'feat: add new feature',
    body: '',
    parentCount: 1,
    author: 'Test Author',
    authorEmail: 'test@example.com',
    timestamp: new Date('2026-02-01'),
    refs: [],
    ...overrides,
  };
}

function createMockFact(overrides: Partial<IHeuristicFact> = {}): IHeuristicFact {
  return {
    text: 'Test decision about architecture',
    type: 'decision',
    source: 'pr-description',
    confidence: 'medium',
    tags: ['typescript'],
    prNumber: 42,
    ...overrides,
  };
}

function createMockHotspot(overrides: Partial<IFileHotspot> = {}): IFileHotspot {
  return {
    path: 'src/lib/services/MyService.ts',
    commitCount: 15,
    totalLinesChanged: 500,
    ...overrides,
  };
}

function createMockTag(overrides: Partial<ITagInfo> = {}): ITagInfo {
  return {
    name: 'v1.0.0',
    sha: 'tag-sha-1',
    isVersionTag: true,
    ...overrides,
  };
}

function createMockTriageResult(overrides: Partial<ITriageResult> = {}): ITriageResult {
  return {
    totalCommits: 100,
    belowThreshold: 80,
    minorInterest: 10,
    highInterest: [],
    linkedToPRs: 5,
    linkedToTags: 3,
    hotspots: [createMockHotspot()],
    tags: [createMockTag()],
    durationMs: 500,
    ...overrides,
  };
}

function createMockExtraction(overrides: Partial<IHeuristicExtractionResult> = {}): IHeuristicExtractionResult {
  return {
    facts: [
      createMockFact({ text: 'Decided to use TypeScript strict mode', type: 'decision' }),
      createMockFact({ text: 'Beware of null returns from findById', type: 'gotcha', prNumber: 55 }),
      createMockFact({ text: 'All interfaces must be prefixed with I', type: 'convention' }),
    ],
    prsProcessed: 5,
    prsSkipped: 0,
    patternsMatched: 3,
    ...overrides,
  };
}

function createMockInput(overrides: Partial<IProfileInput> = {}): IProfileInput {
  return {
    projectName: 'test-project',
    projectRoot: '/home/user/test-project',
    generatedAt: new Date('2026-02-05'),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('RepoProfileService', () => {
  let mockFs: IFileSystem;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockFs = {
      readFile: mock.fn(async () => '# Existing Profile'),
      writeFile: mock.fn(async () => {}),
      stat: mock.fn(async () => ({ mtimeMs: Date.now() })),
    } as unknown as IFileSystem;

    mockLogger = {
      debug: mock.fn(() => {}),
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    } as unknown as ILogger;
  });

  describe('generate', () => {
    it('should generate profile with all data populated', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        triage: createMockTriageResult(),
        extraction: createMockExtraction(),
        codebaseSummary: 'A TypeScript project with clean architecture.',
        recentCommits: [createMockCommit()],
      });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('# Repo Profile: test-project'));
      assert.ok(result.markdown.includes('A TypeScript project with clean architecture.'));
      assert.ok(result.markdown.includes('## Hotspots'));
      assert.ok(result.markdown.includes('## Key Decisions'));
      assert.ok(result.markdown.includes('## Known Gotchas'));
      assert.ok(result.markdown.includes('## Active Concerns'));
      assert.ok(result.markdown.includes('## Recent Activity'));
      assert.strictEqual(result.totalSections, 8);
      assert.strictEqual(result.sectionsPopulated, 8);
      assert.ok(result.filePath.endsWith('.lisa/data/repo-profile.md'));
    });

    it('should write the profile to the correct path', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({ projectRoot: '/my/project' });

      await service.generate(input);

      const writeCalls = (mockFs.writeFile as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(writeCalls.length, 1);
      assert.ok(writeCalls[0].arguments[0].includes('.lisa/data/repo-profile.md'));
      assert.ok(writeCalls[0].arguments[0].startsWith('/my/project'));
    });

    it('should handle missing triage data gracefully', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput(); // No triage

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('*No hotspot data available.*'));
      assert.ok(result.markdown.includes('*No version tag data available.*'));
    });

    it('should handle missing extraction data gracefully', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput(); // No extraction

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('*No decisions captured yet.*'));
      assert.ok(result.markdown.includes('*No gotchas captured yet.*'));
      assert.ok(result.markdown.includes('*No conventions or active concerns captured yet.*'));
    });

    it('should handle missing codebase summary gracefully', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput(); // No summary

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('*No codebase summary available.'));
    });

    it('should handle missing recent commits gracefully', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput(); // No commits

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('*No recent commits found.*'));
    });

    it('should include PR and issue references in facts', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        extraction: createMockExtraction({
          facts: [
            createMockFact({ text: 'Decision with PR', type: 'decision', prNumber: 42, issueNumber: 10 }),
          ],
        }),
      });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('PR #42'));
      assert.ok(result.markdown.includes('Issue #10'));
    });

    it('should limit hotspots to maxHotspots option', async () => {
      const hotspots = Array.from({ length: 20 }, (_, i) =>
        createMockHotspot({ path: `file-${i}.ts`, commitCount: 20 - i })
      );
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        triage: createMockTriageResult({ hotspots }),
      });

      const result = await service.generate(input, { maxHotspots: 5 });

      // Should include 5 files plus "and N more" message
      assert.ok(result.markdown.includes('file-0.ts'));
      assert.ok(result.markdown.includes('file-4.ts'));
      assert.ok(result.markdown.includes('... and 15 more'));
    });

    it('should limit facts per section to maxFactsPerSection option', async () => {
      const facts = Array.from({ length: 15 }, (_, i) =>
        createMockFact({ text: `Decision ${i}`, type: 'decision' })
      );
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        extraction: createMockExtraction({ facts }),
      });

      const result = await service.generate(input, { maxFactsPerSection: 3 });

      assert.ok(result.markdown.includes('Decision 0'));
      assert.ok(result.markdown.includes('Decision 2'));
      assert.ok(result.markdown.includes('... and 12 more'));
    });

    it('should limit recent commits to maxRecentCommits option', async () => {
      const commits = Array.from({ length: 15 }, (_, i) =>
        createMockCommit({ shortSha: `sha${i}`, subject: `Commit ${i}` })
      );
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({ recentCommits: commits });

      const result = await service.generate(input, { maxRecentCommits: 3 });

      assert.ok(result.markdown.includes('sha0'));
      assert.ok(result.markdown.includes('sha2'));
      assert.ok(result.markdown.includes('... and 12 more'));
    });

    it('should report correct sectionsPopulated count with partial data', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        codebaseSummary: 'Summary text',
        recentCommits: [createMockCommit()],
      });

      const result = await service.generate(input);

      // Only overview and recent activity should be populated
      assert.strictEqual(result.sectionsPopulated, 2);
      assert.strictEqual(result.totalSections, 8);
    });

    it('should include date in header', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({ generatedAt: new Date('2026-02-05') });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('2026-02-05'));
    });

    it('should render hotspot table with correct format', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        triage: createMockTriageResult({
          hotspots: [createMockHotspot({ path: 'src/main.ts', commitCount: 10, totalLinesChanged: 200 })],
        }),
      });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('| File | Commits | Lines Changed |'));
      assert.ok(result.markdown.includes('| `src/main.ts` | 10 | 200 |'));
    });

    it('should group version tags by major version in feature waves', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);
      const input = createMockInput({
        triage: createMockTriageResult({
          tags: [
            createMockTag({ name: 'v1.0.0' }),
            createMockTag({ name: 'v1.1.0' }),
            createMockTag({ name: 'v2.0.0' }),
          ],
        }),
      });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('v1.x'));
      assert.ok(result.markdown.includes('v2.x'));
    });

    it('should work without logger', async () => {
      const service = createRepoProfileService(mockFs); // No logger
      const input = createMockInput({
        codebaseSummary: 'Test summary',
      });

      const result = await service.generate(input);

      assert.ok(result.markdown.includes('Test summary'));
      assert.strictEqual(result.sectionsPopulated, 1);
    });
  });

  describe('read', () => {
    it('should return markdown content when file exists', async () => {
      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.read('/my/project');

      assert.strictEqual(result.markdown, '# Existing Profile');
      assert.ok(result.filePath.endsWith('.lisa/data/repo-profile.md'));
    });

    it('should return null markdown when file is missing', async () => {
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => null);

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.read('/my/project');

      assert.strictEqual(result.markdown, null);
      assert.strictEqual(result.freshness.freshness, 'missing');
    });

    it('should calculate freshness for existing file', async () => {
      const recentMtime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => ({ mtimeMs: recentMtime })
      );

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.read('/my/project');

      assert.strictEqual(result.freshness.freshness, 'fresh');
    });

    it('should handle read error gracefully', async () => {
      (mockFs.readFile as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => { throw new Error('Permission denied'); }
      );

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.read('/my/project');

      assert.strictEqual(result.markdown, null);
      // Freshness should still be calculated from stat
      assert.notStrictEqual(result.freshness.freshness, 'missing');
    });
  });

  describe('checkFreshness', () => {
    it('should return fresh when file updated recently', async () => {
      const recentMtime = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => ({ mtimeMs: recentMtime })
      );

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.checkFreshness('/my/project');

      assert.strictEqual(result.freshness, 'fresh');
      assert.ok(result.note.includes('up to date'));
    });

    it('should return stale when file is 3 days old', async () => {
      const staleMtime = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 days ago
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => ({ mtimeMs: staleMtime })
      );

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.checkFreshness('/my/project');

      assert.strictEqual(result.freshness, 'stale');
      assert.ok(result.note.includes('stale'));
    });

    it('should return expired when file is 10 days old', async () => {
      const expiredMtime = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => ({ mtimeMs: expiredMtime })
      );

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.checkFreshness('/my/project');

      assert.strictEqual(result.freshness, 'expired');
      assert.ok(result.note.includes('outdated'));
    });

    it('should return missing when file does not exist', async () => {
      (mockFs.stat as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => null);

      const service = createRepoProfileService(mockFs, mockLogger);

      const result = await service.checkFreshness('/my/project');

      assert.strictEqual(result.freshness, 'missing');
      assert.strictEqual(result.lastUpdated, null);
      assert.strictEqual(result.ageHours, null);
      assert.ok(result.note.includes('lisa onboard'));
    });
  });
});

describe('calculateFreshness (pure function)', () => {
  const now = new Date('2026-02-05T12:00:00Z').getTime();

  it('should return missing when mtimeMs is null', () => {
    const result = calculateFreshness(null, now);
    assert.strictEqual(result.freshness, 'missing');
    assert.strictEqual(result.lastUpdated, null);
    assert.strictEqual(result.ageHours, null);
  });

  it('should return fresh for file updated 1 hour ago', () => {
    const oneHourAgo = now - (1 * 60 * 60 * 1000);
    const result = calculateFreshness(oneHourAgo, now);
    assert.strictEqual(result.freshness, 'fresh');
    assert.ok(result.ageHours !== null && result.ageHours <= 1.1);
  });

  it('should return fresh for file updated exactly 24 hours ago', () => {
    const exactly24h = now - (24 * 60 * 60 * 1000);
    const result = calculateFreshness(exactly24h, now);
    assert.strictEqual(result.freshness, 'fresh');
  });

  it('should return stale for file updated 25 hours ago', () => {
    const hours25 = now - (25 * 60 * 60 * 1000);
    const result = calculateFreshness(hours25, now);
    assert.strictEqual(result.freshness, 'stale');
  });

  it('should return stale for file updated 6 days ago', () => {
    const days6 = now - (6 * 24 * 60 * 60 * 1000);
    const result = calculateFreshness(days6, now);
    assert.strictEqual(result.freshness, 'stale');
  });

  it('should return stale for file updated exactly 7 days ago', () => {
    const exactly7d = now - (7 * 24 * 60 * 60 * 1000);
    const result = calculateFreshness(exactly7d, now);
    assert.strictEqual(result.freshness, 'stale');
  });

  it('should return expired for file updated 8 days ago', () => {
    const days8 = now - (8 * 24 * 60 * 60 * 1000);
    const result = calculateFreshness(days8, now);
    assert.strictEqual(result.freshness, 'expired');
  });

  it('should return expired for very old file', () => {
    const days30 = now - (30 * 24 * 60 * 60 * 1000);
    const result = calculateFreshness(days30, now);
    assert.strictEqual(result.freshness, 'expired');
    assert.ok(result.note.includes('outdated'));
    assert.ok(result.note.includes('lisa onboard --refresh'));
  });

  it('should include age in hours', () => {
    const hours48 = now - (48 * 60 * 60 * 1000);
    const result = calculateFreshness(hours48, now);
    assert.ok(result.ageHours !== null);
    assert.ok(result.ageHours >= 47.9 && result.ageHours <= 48.1);
  });

  it('should include lastUpdated date', () => {
    const mtime = now - (2 * 60 * 60 * 1000);
    const result = calculateFreshness(mtime, now);
    assert.ok(result.lastUpdated instanceof Date);
    assert.strictEqual(result.lastUpdated.getTime(), mtime);
  });
});

describe('renderMarkdown (pure function)', () => {
  const defaultOptions: Required<IProfileGenerateOptions> = {
    maxHotspots: 10,
    maxFactsPerSection: 10,
    maxRecentCommits: 10,
  };

  it('should include project name in header', () => {
    const input = createMockInput({ projectName: 'my-awesome-project' });
    const { markdown } = renderMarkdown(input, defaultOptions);
    assert.ok(markdown.includes('# Repo Profile: my-awesome-project'));
  });

  it('should render all 8 section headers', () => {
    const input = createMockInput();
    const { markdown } = renderMarkdown(input, defaultOptions);

    assert.ok(markdown.includes('## Project Overview'));
    assert.ok(markdown.includes('## Architecture Evolution'));
    assert.ok(markdown.includes('## Hotspots'));
    assert.ok(markdown.includes('## Feature Waves'));
    assert.ok(markdown.includes('## Key Decisions'));
    assert.ok(markdown.includes('## Known Gotchas'));
    assert.ok(markdown.includes('## Active Concerns'));
    assert.ok(markdown.includes('## Recent Activity'));
  });

  it('should count 0 populated sections when no data provided', () => {
    const input = createMockInput();
    const { sectionsPopulated } = renderMarkdown(input, defaultOptions);
    assert.strictEqual(sectionsPopulated, 0);
  });

  it('should count all populated sections when full data provided', () => {
    const input = createMockInput({
      codebaseSummary: 'Summary',
      triage: createMockTriageResult(),
      extraction: createMockExtraction(),
      recentCommits: [createMockCommit()],
    });
    const { sectionsPopulated } = renderMarkdown(input, defaultOptions);
    assert.strictEqual(sectionsPopulated, 8);
  });

  it('should render recent commits with short SHA', () => {
    const input = createMockInput({
      recentCommits: [
        createMockCommit({ shortSha: 'abc1234', subject: 'feat: add login page' }),
      ],
    });
    const { markdown } = renderMarkdown(input, defaultOptions);
    assert.ok(markdown.includes('`abc1234`'));
    assert.ok(markdown.includes('feat: add login page'));
  });

  it('should separate different fact types into correct sections', () => {
    const input = createMockInput({
      extraction: createMockExtraction({
        facts: [
          createMockFact({ text: 'Only decision fact', type: 'decision' }),
          createMockFact({ text: 'Only gotcha fact', type: 'gotcha' }),
          createMockFact({ text: 'Only convention fact', type: 'convention' }),
        ],
      }),
    });
    const { markdown } = renderMarkdown(input, defaultOptions);

    // Find each section and verify the right facts appear in them
    const decisionsIdx = markdown.indexOf('## Key Decisions');
    const gotchasIdx = markdown.indexOf('## Known Gotchas');
    const conventionsIdx = markdown.indexOf('## Active Concerns');
    const recentIdx = markdown.indexOf('## Recent Activity');

    const decisionsSection = markdown.substring(decisionsIdx, gotchasIdx);
    const gotchasSection = markdown.substring(gotchasIdx, conventionsIdx);
    const conventionsSection = markdown.substring(conventionsIdx, recentIdx);

    assert.ok(decisionsSection.includes('Only decision fact'));
    assert.ok(!decisionsSection.includes('Only gotcha fact'));

    assert.ok(gotchasSection.includes('Only gotcha fact'));
    assert.ok(!gotchasSection.includes('Only decision fact'));

    assert.ok(conventionsSection.includes('Only convention fact'));
    assert.ok(!conventionsSection.includes('Only gotcha fact'));
  });
});
