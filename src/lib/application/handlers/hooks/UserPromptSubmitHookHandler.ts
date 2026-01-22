/**
 * User Prompt Submit Hook Handler
 * 
 * CLI command: lisa hook user-prompt-submit
 * 
 * Runs before a user's prompt is submitted to Claude.
 * Can validate, enhance, or log prompts.
 * 
 * Reads JSON from stdin, outputs decision/context to stdout.
 */

import fs from 'fs';
import path from 'path';
import type { Readable, Writable } from 'stream';
import type { IUserPromptSubmitHookInput, IUserPromptSubmitHookOutput } from './types';
import { readJsonStdin, writeJsonStdout, writeToStream, getHookConfig } from './utils';

/**
 * Handler for user prompt submit events via CLI.
 */
export class UserPromptSubmitHookHandler {
  /**
   * Execute the hook handler.
   * Reads from stdin, writes decision/context to stdout.
   */
  async execute(
    stdin: Readable = process.stdin,
    stdout: Writable = process.stdout,
    stderr: Writable = process.stderr
  ): Promise<void> {
    try {
      // 1. Read hook input from stdin
      const input = await readJsonStdin<IUserPromptSubmitHookInput>(stdin);
      const prompt = input.prompt || '';

      if (!prompt) {
        // No prompt - exit cleanly
        await writeJsonStdout({}, stdout);
        return;
      }

      // 2. Log prompt capture to stderr (visible to user)
      const preview = prompt.length > 80 ? prompt.substring(0, 80) + '...' : prompt;
      await writeToStream(stderr, `Captured prompt (${prompt.length} chars): "${preview}"\n`);

      // 3. Check for plan mode and load context if needed
      const permissionMode = input.permission_mode || input.permissionMode || '';
      let additionalContext = '';

      if (permissionMode === 'plan') {
        const planContext = await this.loadPlanModeContext();
        if (planContext) {
          additionalContext = planContext;
          await writeToStream(stderr, 'Plan Mode - Context loaded\n');
        }
      }

      // 4. Validate prompt
      const warnings = this.validatePrompt(prompt);
      if (warnings.length > 0) {
        warnings.forEach(w => writeToStream(stderr, `${w}\n`));
      }

      // 5. Enhance prompt with suggestions
      const suggestions = this.enhancePrompt(prompt);
      if (suggestions.length > 0) {
        suggestions.forEach(s => writeToStream(stderr, `${s}\n`));
      }

      // 6. Log prompt for analytics (fire-and-forget)
      this.logPrompt(prompt);

      // 7. Store prompt to memory (fire-and-forget)
      this.storePromptAsync(prompt);

      // 8. Output response
      const output: IUserPromptSubmitHookOutput = {};
      
      if (additionalContext) {
        output.hookSpecificOutput = {
          hookEventName: 'UserPromptSubmit',
          additionalContext,
        };
      }

      await writeJsonStdout(output, stdout);
    } catch (error) {
      // On error, don't block the prompt
      await writeJsonStdout({}, stdout);
    }
  }

  /**
   * Load context for plan mode.
   */
  private async loadPlanModeContext(): Promise<string | null> {
    try {
      const config = getHookConfig();
      const lines: string[] = [];

      // Load rules summary
      const rulesSummary = await this.loadRulesSummary();
      if (rulesSummary) {
        lines.push('Project Rules Available:');
        lines.push(rulesSummary);
        lines.push('');
      }

      // Load recent memory
      const recentMemory = await this.loadRecentMemory(config.groupId);
      if (recentMemory) {
        lines.push('Recent Memory:');
        lines.push(recentMemory);
        lines.push('');
      }

      return lines.length > 0 ? lines.join('\n') : null;
    } catch {
      return null;
    }
  }

  /**
   * Load rules summary from .claude/rules/lisa (preferred) or .lisa/rules (fallback).
   */
  private async loadRulesSummary(): Promise<string | null> {
    const possiblePaths = [
      path.join(process.cwd(), '.claude', 'rules', 'lisa'),
      path.join(process.cwd(), '.lisa', 'rules'),
    ];

    for (const rulesDir of possiblePaths) {
      if (fs.existsSync(rulesDir)) {
        try {
          const categories = fs.readdirSync(rulesDir);
          const summaries: string[] = [];

          for (const category of categories) {
            const categoryPath = path.join(rulesDir, category);
            if (fs.statSync(categoryPath).isDirectory()) {
              const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.md'));
              if (files.length > 0) {
                summaries.push(`- ${category}/: ${files.join(', ')}`);
              }
            }
          }

          if (summaries.length > 0) {
            return summaries.join('\n');
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Load recent memory via lisa CLI.
   */
  private async loadRecentMemory(groupId: string): Promise<string | null> {
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        `lisa memory load --group "${groupId}" --limit 5 --cache 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      );

      const parsed = JSON.parse(result);
      const facts = Array.isArray(parsed.facts) ? parsed.facts : (Array.isArray(parsed) ? parsed : []);

      if (facts.length === 0) {
        return null;
      }

      return facts
        .slice(0, 5)
        .map((f: { fact?: string; name?: string }) => `- ${f.fact || f.name}`)
        .join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Validate prompt for potentially problematic patterns.
   */
  private validatePrompt(prompt: string): string[] {
    const warnings: string[] = [];

    // Check for overly broad requests
    if (
      prompt.toLowerCase().includes('delete all') ||
      prompt.toLowerCase().includes('remove everything')
    ) {
      warnings.push('  Warning: Destructive operation detected - please be specific');
    }

    // Check for requests without context
    if (prompt.length < 10) {
      warnings.push('  Note: Very short prompt - consider providing more context');
    }

    return warnings;
  }

  /**
   * Enhance prompt with project context suggestions.
   */
  private enhancePrompt(prompt: string): string[] {
    const suggestions: string[] = [];
    const devDir = path.join(process.cwd(), '.dev');

    if (
      prompt.toLowerCase().includes('architecture') ||
      prompt.toLowerCase().includes('structure')
    ) {
      const archPath = path.join(devDir, 'architecture.md');
      if (fs.existsSync(archPath)) {
        suggestions.push('  Tip: Consider referencing @.dev/architecture.md for context');
      }
    }

    if (prompt.toLowerCase().includes('todo') || prompt.toLowerCase().includes('task')) {
      const todoPath = path.join(devDir, 'todo.md');
      if (fs.existsSync(todoPath)) {
        suggestions.push('  Tip: Your todo list is available at @.dev/todo.md');
      }
    }

    return suggestions;
  }

  /**
   * Log prompt for analytics.
   */
  private logPrompt(prompt: string): void {
    const devDir = path.join(process.cwd(), '.dev');
    const logPath = path.join(devDir, '.prompt-log.jsonl');

    try {
      if (!fs.existsSync(devDir)) {
        return; // Don't create .dev if it doesn't exist
      }

      const entry = {
        timestamp: new Date().toISOString(),
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 100),
      };

      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail
    }
  }

  /**
   * Store prompt to memory asynchronously (fire-and-forget).
   */
  private storePromptAsync(prompt: string): void {
    const config = getHookConfig();
    const truncated = prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt;
    const timestamp = new Date().toISOString();

    try {
      const { spawn } = require('child_process');
      const child = spawn(
        'lisa',
        [
          'memory',
          'add',
          `User prompt at ${timestamp}: ${truncated}`,
          '--group',
          config.groupId,
          '--tag',
          'type:prompt',
          '--cache',
        ],
        {
          detached: true,
          stdio: 'ignore',
        }
      );
      child.unref();
    } catch {
      // Silently fail
    }
  }
}
