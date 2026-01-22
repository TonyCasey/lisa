import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { ISessionCaptureService, ICapturedWork, ILogger } from '../../domain';
import { emptyCapturedWork } from '../../domain';

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
 * Parsed work summary from transcript.
 */
export interface IWorkSummary {
  messageCount: number;
  userPrompts: number;
  assistantResponses: number;
  toolCalls: number;
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  summary: string;
}

/**
 * Minimum messages required for capture.
 */
const MIN_MESSAGES_FOR_CAPTURE = 3;

/**
 * Service for capturing session work from Claude Code transcripts.
 *
 * Analyzes session transcript and extracts facts worth remembering.
 * This is the full implementation that replaces the session-stop-worker.
 */
export class SessionCaptureService implements ISessionCaptureService {
  private readonly logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
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

      return {
        facts,
        complexity,
        summary: work.summary || undefined,
      };
    } catch (error) {
      this.logger?.warn('Session capture failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyCapturedWork();
    }
  }

  /**
   * Find the transcript file.
   */
  findTranscript(providedPath?: string): string | null {
    // Try provided path first
    if (providedPath && fs.existsSync(providedPath)) {
      return providedPath;
    }

    // Try common Claude Code transcript locations
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const possibleDirs = [
      path.join(homeDir, '.claude', 'projects'),
      path.join(homeDir, '.claude'),
    ];

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;

      // Look for transcript.jsonl in this directory or subdirectories
      const transcriptPath = path.join(dir, 'transcript.jsonl');
      if (fs.existsSync(transcriptPath)) {
        return transcriptPath;
      }

      // Check one level of subdirectories (project folders)
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subPath = path.join(dir, entry.name, 'transcript.jsonl');
            if (fs.existsSync(subPath)) {
              return subPath;
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    return null;
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
   * Detect repository name from git.
   */
  detectRepo(): string {
    try {
      const url = execSync('git remote get-url origin 2>/dev/null', {
        encoding: 'utf8',
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
