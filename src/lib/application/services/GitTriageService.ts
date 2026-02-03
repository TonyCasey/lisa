/**
 * GitTriageService
 *
 * Application service that scans git history and scores commits
 * for "interestingness" to identify which commits warrant API enrichment.
 *
 * Part of the Git-Powered Memory feature (LISA-7).
 */

import type { IGitClient, IGitLogCommit, IGitCommitStatEntry } from '../../domain/interfaces/IGitClient';
import type {
  IGitTriageService,
  IGitCommitData,
  IGitCommitStats,
  ICommitInterestSignals,
  IScoredCommit,
  ITriageResult,
  ITriageOptions,
  IFileHotspot,
  ITagInfo,
} from '../../domain/interfaces/IGitTriageService';

/**
 * Default triage threshold score.
 * Commits scoring >= this value are considered high-interest.
 */
const DEFAULT_THRESHOLD = 3;

/**
 * Default lookback period in days.
 */
const DEFAULT_DAYS = 90; // 3 months

/**
 * Conventional commit prefixes to detect.
 */
const _CONVENTIONAL_PREFIXES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
  'style',
  'perf',
  'ci',
  'build',
  'revert',
] as const;

/**
 * Decision keywords that indicate architectural/design decisions.
 */
const DECISION_KEYWORDS = [
  'migrate',
  'replace',
  'rewrite',
  'deprecate',
  'breaking',
  'workaround',
  'decision',
  'architecture',
  'redesign',
  'overhaul',
] as const;

/**
 * Scoring weights for interest signals.
 */
const SCORES = {
  largeDiffFiles: 3,      // 10+ files changed
  largeDiffLines: 2,      // 500+ lines changed
  mergeCommitWithPR: 3,   // merge commit with PR reference
  conventionalPrefix: 1,  // has conventional commit prefix
  decisionKeywords: 2,    // contains decision keywords
  createsNewDirectory: 2, // creates new top-level dir
  tagAdjacent: 2,         // within N commits of a tag
  longMessageBody: 1,     // multi-line body
} as const;

/**
 * How close a commit must be to a tag to be "tag-adjacent".
 */
const TAG_ADJACENT_DISTANCE = 3;

export class GitTriageService implements IGitTriageService {
  constructor(private readonly git: IGitClient) {}

  async triage(options?: ITriageOptions): Promise<ITriageResult> {
    const startTime = Date.now();
    const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
    const cwd = options?.cwd;

    // Calculate date range
    const since = options?.since ?? this.getDefaultSince();
    const until = options?.until ?? new Date();

    // Fetch all tags first (for tag-adjacency scoring)
    const tags = this.git.listTags(cwd);
    const tagShas = new Set(tags.map(t => t.sha));
    const tagInfo: ITagInfo[] = tags.map(t => ({
      name: t.name,
      sha: t.sha,
      isVersionTag: this.isVersionTag(t.name),
    }));

    // Fetch commits in the date range
    const rawCommits = this.git.logDetailed({
      since: since.toISOString(),
      until: until.toISOString(),
      maxCount: options?.maxCommits,
      cwd,
    });

    if (rawCommits.length === 0) {
      return this.emptyResult(startTime, tagInfo);
    }

    // Build a map of SHA -> position for tag adjacency
    const shaToPosition = new Map<string, number>();
    rawCommits.forEach((c, i) => shaToPosition.set(c.sha, i));

    // Find positions of tagged commits for adjacency check
    const tagPositions = new Set<number>();
    for (const tag of tags) {
      const pos = shaToPosition.get(tag.sha);
      if (pos !== undefined) {
        // Mark positions within TAG_ADJACENT_DISTANCE
        for (let i = Math.max(0, pos - TAG_ADJACENT_DISTANCE); i <= pos + TAG_ADJACENT_DISTANCE; i++) {
          tagPositions.add(i);
        }
      }
    }

    // Track file hotspots
    const fileStats = new Map<string, { commits: number; lines: number }>();

    // Score each commit
    const scoredCommits: IScoredCommit[] = [];
    const belowThreshold: IScoredCommit[] = [];
    const minorInterest: IScoredCommit[] = [];

    for (let i = 0; i < rawCommits.length; i++) {
      const raw = rawCommits[i];
      const commit = this.parseCommit(raw);

      // Check if tag-adjacent based on position
      const isTagAdjacent = tagPositions.has(i);

      // Quick scoring without stats first
      const quickSignals = this.detectSignals(commit, null, tagShas, isTagAdjacent);
      const quickScore = this.calculateScore(quickSignals);

      // If score is already high enough or we want all stats, fetch detailed stats
      let stats: IGitCommitStats | null = null;
      let finalSignals = quickSignals;
      let finalScore = quickScore;

      if (quickScore >= threshold - 2 || options?.fetchAllStats) {
        // Fetch stats for borderline or high-interest commits
        const rawStats = this.git.getCommitStats(commit.sha, cwd);
        stats = this.parseStats(rawStats);

        // Re-score with stats
        finalSignals = this.detectSignals(commit, stats, tagShas, isTagAdjacent);
        finalScore = this.calculateScore(finalSignals);

        // Update hotspots
        for (const entry of rawStats) {
          const existing = fileStats.get(entry.path) ?? { commits: 0, lines: 0 };
          existing.commits++;
          existing.lines += (entry.added ?? 0) + (entry.deleted ?? 0);
          fileStats.set(entry.path, existing);
        }
      }

      const scored: IScoredCommit = {
        commit,
        stats,
        signals: finalSignals,
        score: finalScore,
        passedTriage: finalScore >= threshold,
      };

      if (finalScore >= threshold) {
        scoredCommits.push(scored);
      } else if (finalScore > 0) {
        minorInterest.push(scored);
      } else {
        belowThreshold.push(scored);
      }
    }

    // Sort high-interest by score descending
    scoredCommits.sort((a, b) => b.score - a.score);

    // Build hotspots list (top 20)
    const hotspots: IFileHotspot[] = Array.from(fileStats.entries())
      .map(([path, data]) => ({
        path,
        commitCount: data.commits,
        totalLinesChanged: data.lines,
      }))
      .sort((a, b) => b.commitCount - a.commitCount || b.totalLinesChanged - a.totalLinesChanged)
      .slice(0, 20);

    // Count PR links and tag links
    const linkedToPRs = scoredCommits.filter(s => s.signals.prNumber !== null).length;
    const linkedToTags = scoredCommits.filter(s => s.signals.isTagAdjacent).length;

    return {
      totalCommits: rawCommits.length,
      belowThreshold: belowThreshold.length,
      minorInterest: minorInterest.length,
      highInterest: scoredCommits,
      linkedToPRs,
      linkedToTags,
      hotspots,
      tags: tagInfo,
      durationMs: Date.now() - startTime,
    };
  }

  scoreCommit(
    commit: IGitCommitData,
    stats: IGitCommitStats | null,
    tagShas: ReadonlySet<string>
  ): IScoredCommit {
    const isTagAdjacent = tagShas.has(commit.sha);
    const signals = this.detectSignals(commit, stats, tagShas, isTagAdjacent);
    const score = this.calculateScore(signals);

    return {
      commit,
      stats,
      signals,
      score,
      passedTriage: score >= DEFAULT_THRESHOLD,
    };
  }

  /**
   * Parse raw git log commit into domain type.
   */
  private parseCommit(raw: IGitLogCommit): IGitCommitData {
    // Extract refs (tags, branches) from ref names string
    const refs = raw.refNames
      .split(',')
      .map(r => r.trim())
      .filter(r => r && r !== 'HEAD');

    return {
      sha: raw.sha,
      shortSha: raw.shortSha,
      subject: raw.subject,
      body: raw.body,
      parentCount: raw.parentShas.length,
      author: raw.authorName,
      authorEmail: raw.authorEmail,
      timestamp: new Date(raw.authorTimestamp * 1000),
      refs,
    };
  }

  /**
   * Parse raw stat entries into domain type.
   */
  private parseStats(entries: readonly IGitCommitStatEntry[]): IGitCommitStats {
    let insertions = 0;
    let deletions = 0;
    const filesAdded: string[] = [];
    const filesDeleted: string[] = [];
    const directories = new Set<string>();

    for (const entry of entries) {
      insertions += entry.added ?? 0;
      deletions += entry.deleted ?? 0;

      if (entry.isNew) {
        filesAdded.push(entry.path);
        // Track directories for new files
        const dir = entry.path.split('/')[0];
        if (dir && dir !== entry.path) {
          directories.add(dir);
        }
      }

      if (entry.isDeleted) {
        filesDeleted.push(entry.path);
      }
    }

    return {
      filesChanged: entries.length,
      insertions,
      deletions,
      filesAdded,
      filesDeleted,
      directoriesCreated: Array.from(directories),
    };
  }

  /**
   * Detect interest signals for a commit.
   */
  private detectSignals(
    commit: IGitCommitData,
    stats: IGitCommitStats | null,
    _tagShas: ReadonlySet<string>,
    isTagAdjacent: boolean
  ): ICommitInterestSignals {
    // Large diff detection
    const largeDiffFiles = stats !== null && stats.filesChanged >= 10;
    const largeDiffLines = stats !== null && (stats.insertions + stats.deletions) >= 500;

    // Merge commit with PR
    const prMatch = commit.subject.match(/Merge pull request #(\d+)/i)
      ?? commit.subject.match(/\(#(\d+)\)/)
      ?? commit.body.match(/PR[:\s#]+(\d+)/i);
    const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;
    const mergeCommitWithPR = commit.parentCount >= 2 && prNumber !== null;

    // Conventional commit
    const conventionalMatch = commit.subject.match(
      /^(feat|fix|refactor|docs|test|chore|style|perf|ci|build|revert)(\(.+\))?[!]?:/i
    );
    const hasConventionalPrefix = conventionalMatch !== null;
    const conventionalType = conventionalMatch ? conventionalMatch[1].toLowerCase() : null;

    // Decision keywords
    const messageText = `${commit.subject} ${commit.body}`.toLowerCase();
    const hasDecisionKeywords = DECISION_KEYWORDS.some(kw => messageText.includes(kw));

    // New directory detection
    const createsNewDirectory = stats !== null && stats.directoriesCreated.length > 0;

    // Long message body
    const hasLongMessageBody = commit.body.split('\n').filter(l => l.trim()).length >= 2;

    return {
      largeDiffFiles,
      largeDiffLines,
      mergeCommitWithPR,
      hasConventionalPrefix,
      conventionalType,
      hasDecisionKeywords,
      createsNewDirectory,
      isTagAdjacent,
      hasLongMessageBody,
      prNumber,
    };
  }

  /**
   * Calculate interest score from signals.
   */
  private calculateScore(signals: ICommitInterestSignals): number {
    let score = 0;

    if (signals.largeDiffFiles) score += SCORES.largeDiffFiles;
    if (signals.largeDiffLines) score += SCORES.largeDiffLines;
    if (signals.mergeCommitWithPR) score += SCORES.mergeCommitWithPR;
    if (signals.hasConventionalPrefix) score += SCORES.conventionalPrefix;
    if (signals.hasDecisionKeywords) score += SCORES.decisionKeywords;
    if (signals.createsNewDirectory) score += SCORES.createsNewDirectory;
    if (signals.isTagAdjacent) score += SCORES.tagAdjacent;
    if (signals.hasLongMessageBody) score += SCORES.longMessageBody;

    return score;
  }

  /**
   * Get default "since" date (3 months ago).
   */
  private getDefaultSince(): Date {
    const date = new Date();
    date.setDate(date.getDate() - DEFAULT_DAYS);
    return date;
  }

  /**
   * Check if a tag name looks like a version tag.
   */
  private isVersionTag(name: string): boolean {
    return /^v?\d+\.\d+(\.\d+)?/.test(name);
  }

  /**
   * Create an empty result (for repos with no commits in range).
   */
  private emptyResult(startTime: number, tags: readonly ITagInfo[]): ITriageResult {
    return {
      totalCommits: 0,
      belowThreshold: 0,
      minorInterest: 0,
      highInterest: [],
      linkedToPRs: 0,
      linkedToTags: 0,
      hotspots: [],
      tags,
      durationMs: Date.now() - startTime,
    };
  }
}
