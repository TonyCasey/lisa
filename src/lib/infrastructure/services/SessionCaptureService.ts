import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { ISessionCaptureService, ICapturedWork, ILogger } from '../../domain';
import { emptyCapturedWork } from '../../domain';
import type { ITranscriptEnricher } from '../../domain/interfaces/ITranscriptEnricher';
import type { IWorkSummary } from '../../domain/interfaces/IWorkSummary';

// Re-export IWorkSummary for backward compatibility with existing consumers
export type { IWorkSummary } from '../../domain/interfaces/IWorkSummary';

/**
 * Transcript message structure from Claude Code's JSONL files.
 */
interface ITranscriptMessage {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  summary?: string;
}

/**
 * Minimum messages required for capture.
 */
const MIN_MESSAGES_FOR_CAPTURE = 3;

/**
 * Transcript candidate with path and modification time.
 */
interface ITranscriptCandidate {
  path: string;
  mtime: number;
}

/**
 * Service for capturing session work from Claude Code transcripts.
 *
 * Analyzes session transcript and extracts facts worth remembering.
 * This is the full implementation that replaces the session-stop-worker.
 */
export class SessionCaptureService implements ISessionCaptureService {
  private readonly logger?: ILogger;
  private readonly transcriptEnricher?: ITranscriptEnricher;

  constructor(logger?: ILogger, transcriptEnricher?: ITranscriptEnricher) {
    this.logger = logger;
    this.transcriptEnricher = transcriptEnricher;
  }

  /**
   * Capture work from the current session.
   *
   * 1. Finds the session transcript
   * 2. Parses transcript for meaningful work
   * 3. Builds facts from work summary
   * 4. Returns captured work with complexity rating
   *
   * @param sessionId - Optional session ID (used in fact tags)
   * @param transcriptPath - Optional explicit transcript path
   */
  async captureSessionWork(sessionId?: string, transcriptPath?: string): Promise<ICapturedWork> {
    try {
      // 1. Find transcript
      const foundPath = this.findTranscript(transcriptPath);
      if (!foundPath) {
        this.logger?.debug('Transcript not found');
        return emptyCapturedWork();
      }

      // 2. Parse transcript
      const work = this.parseTranscript(foundPath);

      // 3. Check if there's significant work
      if (!this.hasSignificantWork(work)) {
        this.logger?.debug('No significant work to capture');
        return emptyCapturedWork();
      }

      // 4. Build facts from work summary
      const facts = this.buildFacts(work, sessionId);
      const complexity = this.rateComplexity(work);

      // 5. Optionally enrich with LLM extraction
      let enrichedFacts: string[] = [];
      let enrichedSummary: string | undefined;

      if (this.transcriptEnricher) {
        try {
          const snippet = this.getTranscriptSnippet(foundPath);
          const enrichment = await this.transcriptEnricher.enrich(work, snippet);

          if (enrichment.facts.length > 0) {
            enrichedFacts = enrichment.facts.map(f => {
              // Filter out any pre-existing metadata tags before appending canonical ones
              const baseTags = f.tags.filter(t =>
                !t.startsWith('type:') && !t.startsWith('confidence:') && !t.startsWith('source:')
              );
              const tags = [...baseTags, `type:${f.type}`, `confidence:${f.confidence}`, 'source:llm-extracted'];
              return `${f.text} [${tags.join(', ')}]`;
            });
          }

          if (enrichment.summary && enrichment.summary.length > 0) {
            enrichedSummary = enrichment.summary;
          }
        } catch (error) {
          this.logger?.warn('LLM enrichment failed, using pattern-based extraction only', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        facts: [...facts, ...enrichedFacts],
        complexity,
        summary: enrichedSummary ?? work.summary ?? undefined,
      };
    } catch (error) {
      this.logger?.warn('Session capture failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyCapturedWork();
    }
  }

  /**
   * Find the transcript file using deterministic resolution.
   *
   * Resolution algorithm:
   * 1. If explicit path is provided and exists, use it directly
   * 2. Otherwise, search standard Claude Code transcript locations
   * 3. Collect all matching transcript candidates
   * 4. Select the newest candidate (by modification time)
   * 5. Log warning if multiple candidates found
   *
   * @param providedPath - Optional explicit transcript path (always preferred)
   * @returns Path to transcript file, or null if not found
   */
  findTranscript(providedPath?: string): string | null {
    // 1. Explicit path is always preferred when provided
    if (providedPath) {
      if (fs.existsSync(providedPath)) {
        this.logger?.debug('Using explicit transcript path', { path: providedPath });
        return providedPath;
      }
      this.logger?.warn('Explicit transcript path not found', { path: providedPath });
      // Don't fall back to search when explicit path provided but not found
      return null;
    }

    // 2. Collect all transcript candidates from standard locations
    const candidates = this.findTranscriptCandidates();

    if (candidates.length === 0) {
      this.logger?.debug('No transcript candidates found');
      return null;
    }

    // 3. Warn if multiple candidates (non-determinism risk)
    if (candidates.length > 1) {
      this.logger?.warn('Multiple transcript candidates found, using newest', {
        candidateCount: candidates.length,
        candidates: candidates.map(c => ({
          path: c.path,
          mtime: new Date(c.mtime).toISOString(),
        })),
      });
    }

    // 4. Sort by mtime descending and return newest
    candidates.sort((a, b) => b.mtime - a.mtime);
    const selected = candidates[0];

    this.logger?.debug('Selected transcript', {
      path: selected.path,
      mtime: new Date(selected.mtime).toISOString(),
    });

    return selected.path;
  }

  /**
   * Find all transcript candidates from standard Claude Code locations.
   *
   * Claude Code stores session transcripts as UUID-named JSONL files:
   *   ~/.claude/projects/<project-folder>/<session-uuid>.jsonl
   *
   * The project folder is derived from the working directory path with
   * path separators replaced by dashes (e.g. C:\dev\lisa → C--dev-lisa).
   *
   * @returns Array of candidates with path and modification time
   */
  private findTranscriptCandidates(): ITranscriptCandidate[] {
    const candidates: ITranscriptCandidate[] = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    if (!fs.existsSync(projectsDir)) return candidates;

    // Derive project folder name from CWD
    // Claude Code convention: C:\dev\lisa → C--dev-lisa
    const cwd = process.cwd();
    const projectFolderName = cwd.replace(/[:\\/]/g, '-');
    const projectDir = path.join(projectsDir, projectFolderName);

    // Determine which directories to search
    const dirsToSearch: string[] = [];

    if (fs.existsSync(projectDir)) {
      dirsToSearch.push(projectDir);
    } else {
      // Fallback: scan all project folders if derived name doesn't match
      this.logger?.debug('Project dir not found, scanning all projects', {
        expected: projectFolderName,
      });
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirsToSearch.push(path.join(projectsDir, entry.name));
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    // UUID pattern: 8-4-4-4-12 hex chars
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

    for (const dir of dirsToSearch) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Match UUID-named .jsonl files (session transcripts, not subagent files)
          if (entry.isFile() && uuidPattern.test(entry.name)) {
            const filePath = path.join(dir, entry.name);
            try {
              const stats = fs.statSync(filePath);
              candidates.push({ path: filePath, mtime: stats.mtimeMs });
            } catch {
              // Skip if can't stat
            }
          }
        }
      } catch {
        // Ignore permission errors on directory listing
      }
    }

    return candidates;
  }

  /**
   * Parse transcript file to extract work summary.
   */
  parseTranscript(transcriptPath: string): IWorkSummary {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    let userPrompts = 0;
    let assistantResponses = 0;
    let toolCalls = 0;
    const filesCreated: string[] = [];
    const filesModified: string[] = [];
    let summaryText = '';

    for (const line of lines) {
      try {
        const msg: ITranscriptMessage = JSON.parse(line);

        // Track message types
        if (msg.type === 'user' || msg.message?.role === 'user') {
          userPrompts++;
        } else if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
          assistantResponses++;

          // Extract summary from last assistant message
          const content = msg.message?.content;
          if (typeof content === 'string') {
            summaryText = content.slice(0, 500);
          } else if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text');
            if (textBlock?.text) {
              summaryText = textBlock.text.slice(0, 500);
            }
          }
        } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
          toolCalls++;
        }

        // Track file operations from summary
        if (msg.summary) {
          if (msg.summary.includes('Created') || msg.summary.includes('Wrote')) {
            const match = msg.summary.match(/(?:Created|Wrote)[:\s]+([^\s,]+)/);
            if (match) filesCreated.push(match[1]);
          }
          if (msg.summary.includes('Modified') || msg.summary.includes('Edited')) {
            const match = msg.summary.match(/(?:Modified|Edited)[:\s]+([^\s,]+)/);
            if (match) filesModified.push(match[1]);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      messageCount: lines.length,
      userPrompts,
      assistantResponses,
      toolCalls,
      filesCreated: [...new Set(filesCreated)],
      filesModified: [...new Set(filesModified)],
      duration: 0, // TODO: Could calculate from timestamps
      summary: summaryText,
    };
  }

  /**
   * Check if there's significant work to capture.
   */
  hasSignificantWork(work: IWorkSummary): boolean {
    // Need at least a few messages
    if (work.messageCount < MIN_MESSAGES_FOR_CAPTURE) {
      return false;
    }

    // Need some actual interaction
    if (work.userPrompts < 1 || work.assistantResponses < 1) {
      return false;
    }

    // File changes indicate real work
    if (work.filesCreated.length > 0 || work.filesModified.length > 0) {
      return true;
    }

    // Tool usage indicates real work
    if (work.toolCalls > 2) {
      return true;
    }

    // Basic threshold
    return work.messageCount >= 5;
  }

  /**
   * Build facts from work summary.
   */
  buildFacts(work: IWorkSummary, sessionId?: string): string[] {
    const facts: string[] = [];
    const sessionTag = sessionId ? ` [session:${sessionId.slice(0, 8)}]` : '';

    // Main session summary fact
    const parts: string[] = [];
    parts.push(`Session work${sessionTag}:`);
    parts.push(`${work.userPrompts} prompts, ${work.assistantResponses} responses`);

    if (work.toolCalls > 0) {
      parts.push(`${work.toolCalls} tool calls`);
    }

    if (work.filesCreated.length > 0) {
      const fileList = work.filesCreated.slice(0, 3).join(', ');
      const more = work.filesCreated.length > 3 ? '...' : '';
      parts.push(`Created: ${fileList}${more}`);
    }

    if (work.filesModified.length > 0) {
      const fileList = work.filesModified.slice(0, 3).join(', ');
      const more = work.filesModified.length > 3 ? '...' : '';
      parts.push(`Modified: ${fileList}${more}`);
    }

    facts.push(parts.join('. '));

    // Add truncated summary as separate fact if meaningful
    if (work.summary && work.summary.length > 50) {
      const shortSummary = work.summary.slice(0, 200).replace(/\n/g, ' ').trim();
      if (shortSummary) {
        facts.push(`Session summary${sessionTag}: ${shortSummary}...`);
      }
    }

    return facts;
  }

  /**
   * Rate the complexity of work performed.
   */
  rateComplexity(work: IWorkSummary): ICapturedWork['complexity'] {
    const totalFiles = work.filesCreated.length + work.filesModified.length;

    // High complexity: many files or extensive tool usage
    if (totalFiles > 5 || work.toolCalls > 20 || work.messageCount > 50) {
      return 'high';
    }

    // Medium complexity: some file changes or moderate tool usage
    if (totalFiles > 0 || work.toolCalls > 5 || work.messageCount > 15) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Extract a snippet of conversation text from the transcript for LLM analysis.
   * Concatenates user and assistant text content, truncated to a reasonable length.
   */
  private getTranscriptSnippet(transcriptPath: string, maxLength = 4000): string {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const parts: string[] = [];
    let totalLength = 0;

    for (const line of lines) {
      try {
        const msg: ITranscriptMessage = JSON.parse(line);
        const role = msg.message?.role ?? msg.type;
        if (role === 'user' || role === 'assistant') {
          const msgContent = msg.message?.content;
          let text = '';
          if (typeof msgContent === 'string') {
            text = msgContent;
          } else if (Array.isArray(msgContent)) {
            const textBlock = msgContent.find(c => c.type === 'text');
            if (textBlock?.text) {
              text = textBlock.text;
            }
          }
          if (text) {
            const part = `[${role}] ${text.slice(0, 500)}`;
            parts.push(part);
            totalLength += part.length;
          }
        }
      } catch {
        // Skip malformed lines
      }

      if (totalLength >= maxLength) break;
    }

    return parts.join('\n\n').slice(0, maxLength);
  }

  /**
   * Detect repository name from git.
   */
  detectRepo(): string {
    try {
      const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      return match ? match[1] : this.getProjectName();
    } catch {
      return this.getProjectName();
    }
  }

  /**
   * Get project name from package.json or directory.
   */
  private getProjectName(): string {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) {
          return pkg.name.replace(/^@[^/]+\//, '');
        }
      }
    } catch {
      /* ignore */
    }
    return path.basename(process.cwd());
  }
}
