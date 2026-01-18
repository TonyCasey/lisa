#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - User Prompt Submit Hook
 *
 * This hook runs before a user's prompt is submitted to Claude.
 * It can be used to validate, enhance, or log prompts.
 *
 * Configuration: .claude/settings.json -> hooks.UserPromptSubmit
 *
 * Note: This hook is optional and only runs if configured.
 * If the hook exits with non-zero status, the prompt submission is cancelled.
 */

const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT, DEV_DIR } = require('../config');

// Session modules (refactored)
const { shouldLoadPlanContext } = require('./utils/session/plan-mode');

// Core modules (refactored)
const { loadRulesSummary } = require('./utils/core/rules-loader');
const { loadMemoryViaScript, loadRetrospectiveViaScript } = require('./utils/core/memory-loader');

// I/O modules (refactored)
const { writePromptAsync } = require('./utils/io/graphiti-writer');

interface HookInput {
  prompt?: string;
  permission_mode?: string;
  permissionMode?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  promptLength: number;
  promptPreview: string;
}




/**
 * Validate prompt for potentially problematic patterns
 */
function validatePrompt(prompt: string): string[] {
  const warnings: string[] = [];

  // Check for overly broad requests
  if (prompt.toLowerCase().includes('delete all') ||
      prompt.toLowerCase().includes('remove everything')) {
    warnings.push('  Destructive operation detected - please be specific');
  }

  // Check for requests without context
  if (prompt.length < 10) {
    warnings.push('  Very short prompt - consider providing more context');
  }

  return warnings;
}

/**
 * Enhance prompt with project context if needed
 */
function enhancePrompt(prompt: string): string[] {
  const suggestions: string[] = [];

  if (prompt.toLowerCase().includes('architecture') ||
      prompt.toLowerCase().includes('structure')) {
    const archPath = path.join(DEV_DIR, 'architecture.md');
    if (fs.existsSync(archPath)) {
      suggestions.push(' Consider referencing @.dev/architecture.md for context');
    }
  }

  if (prompt.toLowerCase().includes('todo') ||
      prompt.toLowerCase().includes('task')) {
    const todoPath = path.join(DEV_DIR, 'todo.md');
    if (fs.existsSync(todoPath)) {
      suggestions.push(' Your todo list is available at @.dev/todo.md');
    }
  }

  return suggestions;
}

/**
 * Log prompt for analytics (optional)
 */
function logPrompt(prompt: string): void {
  const logPath = path.join(DEV_DIR, '.prompt-log.jsonl');
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    promptLength: prompt.length,
    promptPreview: prompt.substring(0, 100)
  };

  try {
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (_error) {
    // Silently fail if logging doesn't work
  }
}

/**
 * Main execution - reads JSON from stdin (Claude Code hook protocol)
 */
function main(): void {
  let inputData = '';

  // Read JSON from stdin
  process.stdin.on('data', (chunk: Buffer) => {
    inputData += chunk;
  });

  process.stdin.on('end', async () => {
    try {
      const hookInput: HookInput = JSON.parse(inputData);
      const prompt = hookInput.prompt || '';

      if (!prompt) {
        console.log('  No prompt in hook input');
        process.exit(0);
      }

      // Log what we captured for debugging
      console.log(`Captured prompt (${prompt.length} chars): "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

      // Check for plan mode and load context on first entry
      const permissionMode = hookInput.permission_mode || hookInput.permissionMode || '';
      if (shouldLoadPlanContext(permissionMode === 'plan', { devDir: DEV_DIR })) {
        console.log('\n Plan Mode - Loading Context...\n');

        // Load rules, memory, and retrospectives in parallel
        const [rules, memory, retrospectives] = await Promise.all([
          Promise.resolve(loadRulesSummary({ projectRoot: PROJECT_ROOT })),
          loadMemoryViaScript(PROJECT_ROOT, 15),
          loadRetrospectiveViaScript(PROJECT_ROOT, 5),
        ]);

        if (rules) {
          console.log(' Project Rules Available:');
          console.log(rules);
        }

        if (retrospectives) {
          console.log('\n Project Learnings (from retrospectives):');
          console.log(retrospectives);
        }

        if (memory) {
          console.log('\n Recent Memory:');
          console.log(memory);
        }

        console.log(''); // Empty line after context
      }

      // Validate prompt
      const warnings = validatePrompt(prompt);
      if (warnings.length > 0) {
        warnings.forEach(warning => console.log(warning));
      }

      // Enhance prompt with suggestions
      const suggestions = enhancePrompt(prompt);
      if (suggestions.length > 0) {
        suggestions.forEach(suggestion => console.log(suggestion));
      }

      // Log prompt for analytics
      logPrompt(prompt);

      // Store to Graphiti MCP for cross-session memory (fire-and-forget, non-blocking)
      writePromptAsync({ text: prompt, cwd: PROJECT_ROOT });

      // Exit immediately - don't wait for Graphiti storage
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(` Failed to parse hook input: ${message}`);
      // Exit with 0 to not block the prompt on errors
      process.exit(0);
    }
  });
}

// Run if called directly
if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(` Prompt validation failed: ${message}`);
    // Exit with 0 to not block the prompt
    process.exit(0);
  }
}

module.exports = { validatePrompt, enhancePrompt, logPrompt };
