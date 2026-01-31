/**
 * IClaudeCliClient
 *
 * Domain interface for Claude CLI operations.
 * Application-layer code uses this interface instead of importing child_process.
 * Infrastructure provides the concrete implementation.
 */

/**
 * Options for running a Claude CLI prompt.
 */
export interface IClaudePromptOptions {
  /** Maximum stdout buffer size in bytes. */
  readonly maxBuffer?: number;
  /** Timeout in milliseconds. */
  readonly timeout?: number;
}

/**
 * Claude CLI client interface for shell-free application layer code.
 */
export interface IClaudeCliClient {
  /**
   * Check if the Claude CLI is installed and available.
   */
  isAvailable(): boolean;

  /**
   * Run a prompt through the Claude CLI.
   * @param prompt - The prompt text to send.
   * @param options - Execution options.
   * @returns The raw CLI output string.
   */
  runPrompt(prompt: string, options?: IClaudePromptOptions): string;
}
