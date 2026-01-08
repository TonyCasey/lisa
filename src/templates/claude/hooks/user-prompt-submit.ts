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
const { spawn } = require('child_process');

const { PROJECT_ROOT, PROMPT_SKILL_PATH, DEV_DIR } = require('../config');

interface HookInput {
  prompt?: string;
  [key: string]: unknown;
}

interface GraphitiResult {
  status: 'ok' | 'skipped' | 'error' | 'timeout';
  error?: string;
  raw?: string;
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
 * Store prompt to Graphiti MCP for cross-session memory
 * Graphiti's LLM automatically classifies the content as:
 * - KeyDecision, DirectionChange, ArchitecturalChoice, Preference, etc.
 * Classification happens server-side based on entity_types in config.yaml
 */
function storeToGraphiti(prompt: string): Promise<GraphitiResult | null> {
  if (!fs.existsSync(PROMPT_SKILL_PATH)) {
    console.log('  Prompt skill not found, skipping Graphiti storage');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const child = spawn('node', [
      PROMPT_SKILL_PATH,
      '--text', prompt,
      '--role', 'user',
      '--source', 'user-prompt'  // Graphiti LLM classifies content automatically
    ], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data; });
    child.stderr.on('data', (data: Buffer) => { stderr += data; });

    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as GraphitiResult;
          resolve(result);
        } catch {
          resolve({ status: 'ok', raw: stdout.trim() });
        }
      } else {
        resolve({ status: 'error', error: stderr.trim() || `exit code ${code}` });
      }
    });

    child.on('error', (err: Error) => {
      resolve({ status: 'error', error: err.message });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve({ status: 'timeout' });
    }, 5000);
  });
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

      // Store to Graphiti MCP for cross-session memory
      const graphitiResult = await storeToGraphiti(prompt);
      if (graphitiResult) {
        if (graphitiResult.status === 'ok') {
          console.log(' Stored to Graphiti memory');
        } else if (graphitiResult.status === 'skipped') {
          console.log(' Duplicate prompt, skipped');
        } else if (graphitiResult.status === 'error') {
          console.log(`  Graphiti storage failed: ${graphitiResult.error}`);
        } else if (graphitiResult.status === 'timeout') {
          console.log('  Graphiti storage timed out');
        }
      }

      // Exit with 0 to allow prompt to proceed
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