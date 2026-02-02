import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { ISessionCaptureService, ICapturedWork, ILogger } from '../../domain';
import { emptyCapturedWork } from '../../domain';
import type { ITranscriptEnricher } from '../../domain/interfaces/ITranscriptEnricher';
import type { IWorkSummary, IDetectedDecision, IDetectedError, IFilePromptCorrelation } from '../../domain/interfaces/IWorkSummary';
import type { TaskType } from '../../domain/interfaces/types/ITaskType';
import { DETECTION_SIGNALS } from '../../domain/interfaces/types/ITaskType';

// Re-export IWorkSummary for backward compatibility with existing consumers
export type { IWorkSummary } from '../../domain/interfaces/IWorkSummary';

/**
 * Transcript message structure from Claude Code's JSONL files.
 */
interface ITranscriptMessage {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; name?: string; is_error?: boolean }>;
  };
  summary?: string;
}

/**
 * Parsed message with role and text for heuristic analysis.
 */
interface IParsedMessage {
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'other';
  text: string;
  toolName?: string;
  isError?: boolean;
}

/**
 * Minimum messages required for capture.
 */
const MIN_MESSAGES_FOR_CAPTURE = 3;

/**
 * Maximum heuristic detection caps.
 */
const MAX_DECISIONS = 3;
const MAX_ERRORS = 2;
const MAX_CORRELATIONS = 3;

/**
 * User confirmation patterns for decision detection.
 */
const CONFIRMATION_PATTERN = /^(yes|ok|sounds good|let'?s go with|do that|go ahead|approved?|agreed?)\b/i;

/**
 * Assistant option-presenting language for decision context.
 */
const OPTION_PRESENTING_PATTERN = /\b(option|approach|alternative|should we|we could|either|or we|recommend|suggest)\b/i;

/**
 * Error patterns in message content.
 */
const STACK_TRACE_PATTERN = /^\s+at\s+/m;
const ERROR_TYPE_PATTERN = /\b(Error|TypeError|ReferenceError|SyntaxError|RangeError):\s+/;

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
        work,
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
   * Searches:
   * - ~/.claude/projects/<project>/transcript.jsonl
   * - ~/.claude/transcript.jsonl
   *
   * @returns Array of candidates with path and modification time
   */
  private findTranscriptCandidates(): ITranscriptCandidate[] {
    const candidates: ITranscriptCandidate[] = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    const possibleDirs = [
      path.join(homeDir, '.claude', 'projects'),
      path.join(homeDir, '.claude'),
    ];

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;

      // Check direct transcript in this directory
      const directPath = path.join(dir, 'transcript.jsonl');
      if (fs.existsSync(directPath)) {
        try {
          const stats = fs.statSync(directPath);
          candidates.push({
            path: directPath,
            mtime: stats.mtimeMs,
          });
        } catch {
          // Skip if can't stat
        }
      }

      // Check subdirectories (project folders)
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subPath = path.join(dir, entry.name, 'transcript.jsonl');
            if (fs.existsSync(subPath)) {
              try {
                const stats = fs.statSync(subPath);
                candidates.push({
                  path: subPath,
                  mtime: stats.mtimeMs,
                });
              } catch {
                // Skip if can't stat
              }
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
   * Parse transcript file to extract work summary including heuristic detections.
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
    const parsedMessages: IParsedMessage[] = [];

    for (const line of lines) {
      try {
        const msg: ITranscriptMessage = JSON.parse(line);

        // Track message types
        if (msg.type === 'user' || msg.message?.role === 'user') {
          userPrompts++;
          const text = this.extractMessageText(msg);
          parsedMessages.push({ role: 'user', text });
        } else if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
          assistantResponses++;
          const text = this.extractMessageText(msg);
          parsedMessages.push({ role: 'assistant', text });

          // Extract summary from last assistant message
          if (text) {
            summaryText = text.slice(0, 500);
          }
        } else if (msg.type === 'tool_use') {
          toolCalls++;
          const toolName = this.extractToolName(msg);
          parsedMessages.push({ role: 'tool_use', text: '', toolName });
        } else if (msg.type === 'tool_result') {
          toolCalls++;
          const isError = this.extractToolError(msg);
          const text = this.extractMessageText(msg);
          parsedMessages.push({ role: 'tool_result', text, isError });
        } else {
          parsedMessages.push({ role: 'other', text: '' });
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
        parsedMessages.push({ role: 'other', text: '' });
      }
    }

    const uniqueFilesCreated = [...new Set(filesCreated)];
    const uniqueFilesModified = [...new Set(filesModified)];

    // Run heuristic detectors
    const detectedDecisions = this.detectDecisions(parsedMessages);
    const detectedErrors = this.detectErrors(parsedMessages);
    const filePromptCorrelations = this.correlateFilePrompts(
      parsedMessages, uniqueFilesCreated, uniqueFilesModified
    );
    const detectedTaskType = this.detectTaskType(parsedMessages);

    return {
      messageCount: lines.length,
      userPrompts,
      assistantResponses,
      toolCalls,
      filesCreated: uniqueFilesCreated,
      filesModified: uniqueFilesModified,
      duration: 0,
      summary: summaryText,
      detectedDecisions: detectedDecisions.length > 0 ? detectedDecisions : undefined,
      detectedErrors: detectedErrors.length > 0 ? detectedErrors : undefined,
      filePromptCorrelations: filePromptCorrelations.length > 0 ? filePromptCorrelations : undefined,
      detectedTaskType,
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
   * Build facts from work summary including heuristic-detected facts.
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

    // Add heuristic-detected decision facts
    if (work.detectedDecisions) {
      for (const decision of work.detectedDecisions) {
        facts.push(`DECISION: ${decision.text} [source:session-capture, confidence:medium, type:decision]`);
      }
    }

    // Add heuristic-detected error facts
    if (work.detectedErrors) {
      for (const error of work.detectedErrors) {
        facts.push(`ERROR: ${error.text} [source:session-capture, confidence:medium, type:error]`);
      }
    }

    // Add file-prompt correlation facts
    if (work.filePromptCorrelations) {
      for (const corr of work.filePromptCorrelations) {
        facts.push(`FILE-CONTEXT: ${corr.filePath} — triggered by: ${corr.triggerSnippet} [source:session-capture, confidence:medium, type:correlation, file:${corr.filePath}]`);
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

  // ============================================================
  // Heuristic Detection Methods
  // ============================================================

  /**
   * Detect user decisions from confirmation patterns.
   *
   * Scans for user messages matching confirmation patterns (yes, ok, sounds good, etc.)
   * preceded by assistant messages that present options or recommendations.
   */
  private detectDecisions(messages: IParsedMessage[]): IDetectedDecision[] {
    const decisions: IDetectedDecision[] = [];

    for (let i = 0; i < messages.length; i++) {
      if (decisions.length >= MAX_DECISIONS) break;

      const msg = messages[i];
      if (msg.role !== 'user') continue;
      if (!CONFIRMATION_PATTERN.test(msg.text.trim())) continue;

      // Look backward within 3 messages for an assistant message with options
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prev = messages[j];
        if (prev.role !== 'assistant') continue;
        if (!OPTION_PRESENTING_PATTERN.test(prev.text)) continue;

        // Extract decision topic from the assistant's message (first sentence or first 120 chars)
        const topic = this.extractDecisionTopic(prev.text);
        if (topic) {
          decisions.push({
            text: topic,
            userMessage: msg.text.slice(0, 100),
            confidence: 0.6,
          });
        }
        break;
      }
    }

    return decisions;
  }

  /**
   * Detect errors from stack traces, error types, tool failures, and retry patterns.
   */
  private detectErrors(messages: IParsedMessage[]): IDetectedError[] {
    const errors: IDetectedError[] = [];

    // 1. Detect stack traces and Error: patterns in message content
    for (const msg of messages) {
      if (errors.length >= MAX_ERRORS) break;
      if (!msg.text) continue;

      if (STACK_TRACE_PATTERN.test(msg.text)) {
        const errorLine = this.extractErrorLine(msg.text);
        if (errorLine) {
          errors.push({
            text: errorLine,
            errorType: 'stack-trace',
            context: msg.text.slice(0, 200),
          });
        }
      } else if (ERROR_TYPE_PATTERN.test(msg.text)) {
        const match = msg.text.match(ERROR_TYPE_PATTERN);
        if (match) {
          const matchIndex = msg.text.indexOf(match[0]);
          const errorText = msg.text.slice(matchIndex, matchIndex + 150).split('\n')[0];
          errors.push({
            text: errorText.trim(),
            errorType: 'stack-trace',
          });
        }
      }
    }

    // 2. Detect tool failures
    if (errors.length < MAX_ERRORS) {
      for (const msg of messages) {
        if (errors.length >= MAX_ERRORS) break;
        if (msg.role === 'tool_result' && msg.isError) {
          errors.push({
            text: `Tool failure: ${msg.text.slice(0, 100)}`,
            errorType: 'tool-failure',
          });
        }
      }
    }

    // 3. Detect retry patterns (same tool_use name >2 times in sequence)
    if (errors.length < MAX_ERRORS) {
      let consecutiveCount = 0;
      let lastToolName = '';
      for (const msg of messages) {
        if (msg.role === 'tool_use' && msg.toolName) {
          if (msg.toolName === lastToolName) {
            consecutiveCount++;
          } else {
            consecutiveCount = 1;
            lastToolName = msg.toolName;
          }
          if (consecutiveCount > 2 && errors.length < MAX_ERRORS) {
            errors.push({
              text: `Retry pattern detected: tool "${lastToolName}" called ${consecutiveCount}+ times consecutively`,
              errorType: 'retry-pattern',
            });
            break;
          }
        } else if (msg.role !== 'tool_result') {
          // Reset on non-tool messages (but tool_result follows tool_use so skip that)
          consecutiveCount = 0;
          lastToolName = '';
        }
      }
    }

    return errors;
  }

  /**
   * Correlate file changes with preceding user prompts.
   *
   * For each changed file, find preceding user prompt (within 3-message window)
   * whose text mentions the file name or related keywords.
   */
  private correlateFilePrompts(
    messages: IParsedMessage[],
    filesCreated: readonly string[],
    filesModified: readonly string[]
  ): IFilePromptCorrelation[] {
    const correlations: IFilePromptCorrelation[] = [];
    const allFiles = [...filesCreated, ...filesModified];
    const matchedFiles = new Set<string>();

    // Find assistant messages that mention each file (tool responses),
    // then search backward within 3-message window for the triggering user prompt.
    const MESSAGE_WINDOW = 3;

    for (const filePath of allFiles) {
      if (correlations.length >= MAX_CORRELATIONS) break;
      if (matchedFiles.has(filePath)) continue;

      const fileName = path.basename(filePath);
      const fileNameNoExt = fileName.replace(/\.[^.]+$/, '');
      const fileNameLower = fileName.toLowerCase();
      const fileNameNoExtLower = fileNameNoExt.toLowerCase();

      // Find the last assistant message mentioning this file (tool response)
      let fileMessageIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].text) {
          const textLower = messages[i].text.toLowerCase();
          if (textLower.includes(fileNameLower) || textLower.includes(fileNameNoExtLower)) {
            fileMessageIndex = i;
            break;
          }
        }
      }

      // Search backward from file message within 3-message window for user prompt
      const searchStart = fileMessageIndex >= 0 ? fileMessageIndex : messages.length - 1;
      let messagesChecked = 0;
      for (let j = searchStart; j >= 0 && messagesChecked < MESSAGE_WINDOW; j--) {
        messagesChecked++;
        if (messages[j].role !== 'user' || !messages[j].text) continue;

        const textLower = messages[j].text.toLowerCase();
        if (textLower.includes(fileNameLower) || textLower.includes(fileNameNoExtLower)) {
          correlations.push({
            filePath,
            triggerSnippet: messages[j].text.slice(0, 100),
          });
          matchedFiles.add(filePath);
          break;
        }
      }
    }

    return correlations;
  }

  /**
   * Detect the dominant task type from user prompts using DETECTION_SIGNALS.
   */
  private detectTaskType(messages: IParsedMessage[]): TaskType | undefined {
    const scores: Record<TaskType, number> = Object.keys(DETECTION_SIGNALS).reduce(
      (acc, key) => ({ ...acc, [key]: 0 }),
      {} as Record<TaskType, number>
    );

    for (const msg of messages) {
      if (msg.role !== 'user' || !msg.text) continue;
      const textLower = msg.text.toLowerCase();

      for (const [taskType, signals] of Object.entries(DETECTION_SIGNALS)) {
        for (const signal of signals) {
          if (textLower.includes(signal.toLowerCase())) {
            scores[taskType as TaskType]++;
          }
        }
      }
    }

    // Find dominant type
    let maxScore = 0;
    let dominant: TaskType | undefined;
    for (const [taskType, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        dominant = taskType as TaskType;
      }
    }

    // Only return if there's a meaningful signal
    return maxScore > 0 ? dominant : undefined;
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Extract text content from a transcript message.
   */
  private extractMessageText(msg: ITranscriptMessage): string {
    const content = msg.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const textBlock = content.find(c => c.type === 'text');
      if (textBlock?.text) {
        return textBlock.text;
      }
    }
    return '';
  }

  /**
   * Extract tool name from a transcript message.
   */
  private extractToolName(msg: ITranscriptMessage): string | undefined {
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      const toolBlock = content.find(c => c.name);
      if (toolBlock?.name) return toolBlock.name;
    }
    return undefined;
  }

  /**
   * Check if a tool_result message indicates an error.
   */
  private extractToolError(msg: ITranscriptMessage): boolean {
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      return content.some(c => c.is_error === true);
    }
    return false;
  }

  /**
   * Extract the first Error: line from text containing a stack trace.
   */
  private extractErrorLine(text: string): string | null {
    const lines = text.split('\n');
    for (const line of lines) {
      if (ERROR_TYPE_PATTERN.test(line)) {
        return line.trim().slice(0, 150);
      }
    }
    // Fallback: use first line
    return lines[0] ? lines[0].trim().slice(0, 150) : null;
  }

  /**
   * Extract a decision topic from an assistant's message.
   * Takes the first sentence or first 120 characters.
   */
  private extractDecisionTopic(text: string): string | null {
    if (!text) return null;
    // Try to get first sentence
    const sentenceMatch = text.match(/^[^.!?]+[.!?]/);
    if (sentenceMatch && sentenceMatch[0].length <= 120) {
      return sentenceMatch[0].trim();
    }
    // Fallback: first 120 chars
    return text.slice(0, 120).trim();
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
