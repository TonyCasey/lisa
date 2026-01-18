/**
 * Transcript Parser for Claude Code session transcripts
 *
 * Parses JSONL transcript files to extract work performed during a session.
 * Used by the session-stop hook to analyze completed work.
 */
export {}; // mark as module to keep scoped declarations

const fs = require('fs');
const path = require('path');

interface IToolInput {
  file_path?: string;
  content?: string;
  command?: string;
  old_string?: string;
  new_string?: string;
  pattern?: string;
}

interface IMessageContent {
  type: string;
  text?: string;
  tool_use_id?: string;
  name?: string;
  input?: IToolInput;
}

interface IMessage {
  role: 'user' | 'assistant';
  content: string | IMessageContent[];
}

interface ITranscriptEntry {
  type?: string;
  message?: IMessage;
  timestamp?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  costUSD?: number;
  durationMs?: number;
  uuid?: string;
}

interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

/**
 * Parse a JSONL transcript file and extract work summary
 */
function parseTranscript(transcriptPath: string): IWorkSummary {
  const summary: IWorkSummary = {
    filesModified: new Set<string>(),
    filesCreated: new Set<string>(),
    commandsRun: [],
    toolsUsed: new Map<string, number>(),
    assistantSummary: '',
    timestamp: new Date().toISOString(),
    durationMs: 0,
    totalCostUSD: 0,
  };

  if (!fs.existsSync(transcriptPath)) {
    return summary;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter((line: string) => line.trim());

    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    let lastAssistantMessage = '';

    for (const line of lines) {
      try {
        const entry: ITranscriptEntry = JSON.parse(line);

        // Skip side chains (subagent work - track separately if needed)
        if (entry.isSidechain) {
          continue;
        }

        // Track timestamps for duration calculation
        if (entry.timestamp) {
          const ts = new Date(entry.timestamp).getTime();
          if (firstTimestamp === null) firstTimestamp = ts;
          lastTimestamp = ts;
        }

        // Track costs
        if (entry.costUSD) {
          summary.totalCostUSD += entry.costUSD;
        }

        // Process messages
        if (entry.message) {
          processMessage(entry.message, summary);

          // Track last assistant message for summary
          if (entry.message.role === 'assistant') {
            const text = extractTextFromMessage(entry.message);
            if (text) {
              lastAssistantMessage = text;
            }
          }
        }
      } catch (_parseErr) {
        // Skip malformed lines, continue parsing
        continue;
      }
    }

    // Calculate duration
    if (firstTimestamp !== null && lastTimestamp !== null) {
      summary.durationMs = lastTimestamp - firstTimestamp;
    }

    // Set the assistant summary (truncate if too long)
    summary.assistantSummary = truncateText(lastAssistantMessage, 500);
  } catch (_err) {
    // Return empty summary on read errors
  }

  return summary;
}

/**
 * Process a message entry and extract tool uses
 */
function processMessage(message: IMessage, summary: IWorkSummary): void {
  if (!message.content) return;

  const contents: IMessageContent[] = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: message.content as string }];

  for (const content of contents) {
    if (content.type === 'tool_use' && content.name) {
      // Track tool usage count
      const count = summary.toolsUsed.get(content.name) || 0;
      summary.toolsUsed.set(content.name, count + 1);

      // Extract file operations
      if (content.input) {
        processToolInput(content.name, content.input, summary);
      }
    }

    if (content.type === 'tool_result' && content.name) {
      // Also track from tool results if present
      const count = summary.toolsUsed.get(content.name) || 0;
      if (count === 0) {
        summary.toolsUsed.set(content.name, 1);
      }
    }
  }
}

/**
 * Process tool input to extract file/command information
 */
function processToolInput(toolName: string, input: IToolInput, summary: IWorkSummary): void {
  const filePath = input.file_path;

  switch (toolName) {
    case 'Write':
      if (filePath) {
        summary.filesCreated.add(normalizePath(filePath));
      }
      break;

    case 'Edit':
    case 'MultiEdit':
      if (filePath) {
        summary.filesModified.add(normalizePath(filePath));
      }
      break;

    case 'Bash':
      if (input.command) {
        // Track non-trivial commands (skip simple reads)
        const cmd = input.command.trim();
        if (!isReadOnlyCommand(cmd)) {
          summary.commandsRun.push(truncateText(cmd, 200));
        }
      }
      break;

    case 'NotebookEdit':
      if (filePath) {
        summary.filesModified.add(normalizePath(filePath));
      }
      break;
  }
}

/**
 * Check if a command is read-only (doesn't modify state)
 */
function isReadOnlyCommand(cmd: string): boolean {
  const readOnlyPatterns = [
    /^ls\s/,
    /^cat\s/,
    /^head\s/,
    /^tail\s/,
    /^grep\s/,
    /^find\s/,
    /^which\s/,
    /^echo\s/,
    /^pwd$/,
    /^git\s+status/,
    /^git\s+log/,
    /^git\s+diff/,
    /^git\s+show/,
    /^git\s+branch/,
    /^npm\s+list/,
    /^node\s+-[evp]/,
  ];

  return readOnlyPatterns.some((pattern) => pattern.test(cmd));
}

/**
 * Extract text content from a message
 */
function extractTextFromMessage(message: IMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const textParts = message.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text as string);
    return textParts.join('\n');
  }

  return '';
}

/**
 * Normalize a file path (remove leading cwd, make relative)
 */
function normalizePath(filePath: string): string {
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length + 1);
  }
  // Remove leading slash for absolute paths outside cwd
  if (filePath.startsWith('/')) {
    return filePath;
  }
  return filePath;
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Find the most recent transcript file in a directory
 */
function findMostRecentTranscript(dir: string): string | null {
  if (!fs.existsSync(dir)) {
    return null;
  }

  try {
    const files = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.jsonl'))
      .map((f: string) => {
        const fullPath = path.join(dir, f);
        return {
          path: fullPath,
          mtime: fs.statSync(fullPath).mtime.getTime(),
        };
      })
      .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Get files modified during the session
 */
function getFilesModified(summary: IWorkSummary): Set<string> {
  return summary.filesModified;
}

/**
 * Get tool usage distribution
 */
function getToolDistribution(summary: IWorkSummary): Map<string, number> {
  return summary.toolsUsed;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

module.exports = {
  parseTranscript,
  findMostRecentTranscript,
  getFilesModified,
  getToolDistribution,
  formatDuration,
};
