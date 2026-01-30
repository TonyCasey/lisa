/**
 * CLI Utility Functions
 *
 * Shared utilities used by CLI command modules:
 * - getSkillCacheEnv: environment setup for skill scripts
 * - spawnAndWait: spawn child process and wait for completion
 * - runPrWatchLoop: foreground polling loop for PR watch
 */

import {spawn} from 'child_process';
import path from 'path';
import chalk from 'chalk';
import type {IPrPollOptions, IPrPollResult} from '../application/handlers';

export interface IPrWatchLoopOptions {
  handler: { poll: (options: IPrPollOptions) => Promise<IPrPollResult> };
  pollOptions: IPrPollOptions;
  intervalMinutes: number;
  json: boolean;
  printResult: (result: IPrPollResult) => void;
  stopOnResolved: boolean;
}

export function getSkillCacheEnv(skillName: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.LISA_SKILL_CACHE_DIR && !env.LISA_CACHE_DIR) {
    env.LISA_SKILL_CACHE_DIR = path.join(process.cwd(), '.lisa', 'skills', skillName, 'cache');
  }
  return env;
}

/**
 * Spawn a child process and wait for it to complete.
 * Returns a promise that resolves when the process exits successfully,
 * or rejects on error or non-zero exit code.
 */
export function spawnAndWait(
  scriptPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      env: env || process.env,
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start skill: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Exit with the same code as the child process
        process.exit(code ?? 1);
      }
    });
  });
}

export async function runPrWatchLoop(options: IPrWatchLoopOptions): Promise<void> {
  const { handler, pollOptions, intervalMinutes, json, printResult, stopOnResolved } = options;
  let interrupted = false;
  let lastResultMessage: string | undefined;
  let dots = '';
  const intervalMs = intervalMinutes * 60 * 1000;
  const prLabel = pollOptions.prNumber ? `PR #${pollOptions.prNumber}` : 'PRs';
  const handleSigint = () => {
    interrupted = true;
  };
  process.on('SIGINT', handleSigint);

  try {
    while (!interrupted) {
      const result = await handler.poll(pollOptions);
      lastResultMessage = result.message;

      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.totalChanges === 0 && result.totalErrors === 0) {
        dots += '.';
        console.log(chalk.dim(`Watching ${prLabel} for updates${dots}`));
      } else {
        dots = '';
        printResult(result);
      }

      if (!result.success) {
        throw new Error(result.message || 'Poll failed');
      }

      if (stopOnResolved) {
        const allResolved = result.items.length > 0
          && result.items.every(item => item.currentState.unresolvedComments === 0);
        if (allResolved && result.totalChanges === 0) {
          if (!json) {
            console.log(chalk.green('All review threads resolved. Stopping watch.'));
          }
          break;
        }
      }

      if (interrupted) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } finally {
    process.off('SIGINT', handleSigint);
    if (interrupted && lastResultMessage && !json) {
      console.log(chalk.bold(`Final summary: ${lastResultMessage}`));
    }
  }
}
