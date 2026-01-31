/**
 * ClaudeCliClient
 *
 * Infrastructure implementation of IClaudeCliClient.
 * Wraps Claude CLI operations using child_process.
 */

import { spawnSync } from 'child_process';
import type { IClaudeCliClient, IClaudePromptOptions } from '../../domain/interfaces/IClaudeCliClient';

export class ClaudeCliClient implements IClaudeCliClient {
  isAvailable(): boolean {
    try {
      const result = spawnSync('claude', ['--version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  runPrompt(prompt: string, options?: IClaudePromptOptions): string {
    const result = spawnSync('claude', ['-p', prompt], {
      encoding: 'utf8',
      maxBuffer: options?.maxBuffer ?? 5 * 1024 * 1024,
      timeout: options?.timeout ?? 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Claude CLI exited with code ${result.status}: ${result.stderr || ''}`);
    }

    return result.stdout;
  }
}
