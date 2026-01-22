/**
 * CLI I/O Utilities.
 *
 * Handles stdin/stdout communication for CLI hooks.
 * Used by hook commands to read input and write output.
 */

import type { Readable, Writable } from 'stream';
import type { SessionTrigger } from '../../domain';

/**
 * Default timeout for stdin reads (ms).
 */
const DEFAULT_STDIN_TIMEOUT_MS = 100;

/**
 * Read JSON input from stdin with timeout.
 *
 * Returns empty object if stdin is empty or times out.
 *
 * @param stdin - Input stream (defaults to process.stdin)
 * @param timeoutMs - Timeout in milliseconds
 */
export async function readJsonFromStdin<T>(
  stdin: Readable = process.stdin,
  timeoutMs: number = DEFAULT_STDIN_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve) => {
    let input = '';

    const timeout = setTimeout(() => {
      resolve({} as T);
    }, timeoutMs);

    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      input += chunk;
    });

    stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(input) as T);
      } catch {
        resolve({} as T);
      }
    });

    // Handle case where stdin is already closed
    if ('readableEnded' in stdin && stdin.readableEnded) {
      clearTimeout(timeout);
      resolve({} as T);
    }
  });
}

/**
 * Write JSON output to stdout.
 *
 * Handles backpressure properly.
 *
 * @param data - Data to serialize and write
 * @param stdout - Output stream (defaults to process.stdout)
 */
export async function writeJsonToStdout<T>(
  data: T,
  stdout: Writable = process.stdout
): Promise<void> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    const flushed = stdout.write(json);
    if (flushed) {
      resolve();
      return;
    }
    stdout.once('drain', resolve);
    stdout.once('error', reject);
  });
}

/**
 * Write text to a stream, handling backpressure.
 *
 * @param stream - Output stream
 * @param text - Text to write
 */
export async function writeToStream(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve) => {
    const flushed = stream.write(text);
    if (flushed) {
      resolve();
      return;
    }
    stream.once('drain', resolve);
  });
}

/**
 * Write a status message to stderr.
 *
 * Status messages are shown to the user in Claude Code.
 *
 * @param message - Message to write
 * @param stderr - Error stream (defaults to process.stderr)
 */
export async function writeStatus(
  message: string,
  stderr: Writable = process.stderr
): Promise<void> {
  return writeToStream(stderr, `${message}\n`);
}

/**
 * Parse session trigger from Claude Code hook input.
 *
 * Claude Code sends different values depending on the event:
 * - source: "startup", "resume"
 * - session_type: "new", "existing"
 *
 * @param source - The source field from hook input
 * @param sessionType - The session_type field from hook input
 */
export function parseTrigger(source?: string, sessionType?: string): SessionTrigger {
  // Direct source mapping
  if (source === 'startup' || source === 'resume' || source === 'compact' || source === 'clear') {
    return source;
  }

  // Infer from session_type
  if (sessionType === 'new') {
    return 'startup';
  }
  if (sessionType === 'existing') {
    return 'resume';
  }

  // Default to startup
  return 'startup';
}

/**
 * Claude Code hook input for session start.
 */
export interface ISessionStartInput {
  source?: string;
  session_type?: string;
  cwd?: string;
  session_id?: string;
}

/**
 * Claude Code hook input for session stop.
 */
export interface ISessionStopInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/**
 * Claude Code hook input for prompt submit.
 */
export interface IPromptSubmitInput {
  prompt?: string;
  content?: string;
  permission_mode?: string;
  permissionMode?: string;
  session_id?: string;
}

/**
 * Claude Code hook output format.
 */
export interface IHookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
}
