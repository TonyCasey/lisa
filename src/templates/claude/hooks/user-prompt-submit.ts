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

// Plan mode state tracking
const PLAN_MODE_STATE_FILE = path.join(DEV_DIR, '.plan-mode-state.json');
const PLAN_MODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RULES_DIR = path.join(PROJECT_ROOT, '.agents/rules');
const MEMORY_SCRIPT = path.join(PROJECT_ROOT, '.agents/skills/memory/scripts/memory.js');

interface HookInput {
  prompt?: string;
  permission_mode?: string;
  permissionMode?: string;
  [key: string]: unknown;
}

interface GraphitiResult {
  status: 'ok' | 'skipped' | 'error' | 'timeout' | 'unavailable';
  error?: string;
  raw?: string;
}

interface LogEntry {
  timestamp: string;
  promptLength: number;
  promptPreview: string;
}

interface PlanModeState {
  loadedAt: string;
}

interface MemoryResult {
  status: string;
  facts?: Array<{ fact: string }>;
}

/**
 * Check if we should load plan context (first entry into plan mode)
 * Returns true only on first entry, not on subsequent prompts in plan mode
 */
function shouldLoadPlanContext(isPlanMode: boolean): boolean {
  if (!isPlanMode) {
    // Not in plan mode - clear state if exists
    try {
      if (fs.existsSync(PLAN_MODE_STATE_FILE)) {
        fs.unlinkSync(PLAN_MODE_STATE_FILE);
      }
    } catch {
      /* ignore cleanup errors */
    }
    return false;
  }

  // In plan mode - check if we already loaded context this session
  if (fs.existsSync(PLAN_MODE_STATE_FILE)) {
    try {
      const state: PlanModeState = JSON.parse(fs.readFileSync(PLAN_MODE_STATE_FILE, 'utf8'));
      const ageMs = Date.now() - new Date(state.loadedAt).getTime();
      // Context was loaded recently - skip
      if (ageMs < PLAN_MODE_TTL_MS) {
        return false;
      }
    } catch {
      /* ignore parse errors, reload */
    }
  }

  // First time in plan mode - mark as loaded and return true
  try {
    // Ensure DEV_DIR exists
    if (!fs.existsSync(DEV_DIR)) {
      fs.mkdirSync(DEV_DIR, { recursive: true });
    }
    fs.writeFileSync(
      PLAN_MODE_STATE_FILE,
      JSON.stringify({
        loadedAt: new Date().toISOString(),
      })
    );
  } catch {
    /* continue even if state write fails */
  }

  return true;
}

/**
 * Load rules summary from .agents/rules directory
 * Returns concise list of available rules with key topics
 */
function loadRulesSummary(): string | null {
  if (!fs.existsSync(RULES_DIR)) {
    return null;
  }

  const rules: string[] = [];
  const categories = ['shared', 'typescript', 'python', 'go'];

  for (const category of categories) {
    const categoryDir = path.join(RULES_DIR, category);
    if (!fs.existsSync(categoryDir)) continue;

    try {
      const files = fs.readdirSync(categoryDir).filter((f: string) => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(categoryDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          // Extract title from first H1
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
          // Extract key headings (H2s) - first 3
          const h2s = content.match(/^##\s+(.+)$/gm) || [];
          const topics = h2s
            .slice(0, 3)
            .map((h: string) => h.replace(/^##\s+/, ''))
            .join(', ');

          rules.push(`- ${category}/${file}: ${title}${topics ? ` (${topics})` : ''}`);
        } catch {
          /* skip unreadable files */
        }
      }
    } catch {
      /* skip unreadable directories */
    }
  }

  return rules.length > 0 ? rules.join('\n') : null;
}

/**
 * Load memory via memory.js script
 * Returns formatted recent facts from Graphiti
 */
function loadPlanModeMemory(): Promise<string | null> {
  if (!fs.existsSync(MEMORY_SCRIPT)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const child = spawn('node', [MEMORY_SCRIPT, 'load', '--cache', '--limit', '15'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data;
    });
    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result: MemoryResult = JSON.parse(stdout);
          if (result.status === 'ok' && result.facts && result.facts.length > 0) {
            // Format facts concisely
            const formatted = result.facts
              .slice(0, 10)
              .map((f) => `- ${f.fact}`)
              .join('\n');
            resolve(formatted);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * Load retrospective records from memory
 * Returns formatted retrospective learnings (naming, structure, style, gotchas)
 */
function loadRetrospectiveMemory(): Promise<string | null> {
  if (!fs.existsSync(MEMORY_SCRIPT)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const child = spawn('node', [MEMORY_SCRIPT, 'load', '--cache', '--query', 'RETROSPECTIVE', '--limit', '5'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data;
    });
    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result: MemoryResult = JSON.parse(stdout);
          if (result.status === 'ok' && result.facts && result.facts.length > 0) {
            // Format retrospective facts - these contain learnings about the project
            const formatted = result.facts
              .slice(0, 3) // Limit to most recent 3 retrospectives
              .map((f) => {
                // Clean up the fact text, removing the RETROSPECTIVE: prefix if present
                const text = f.fact.replace(/^RETROSPECTIVE:\s*/i, '');
                return `- ${text}`;
              })
              .join('\n');
            resolve(formatted);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
  });
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
 * Check if Graphiti MCP server is available
 * Returns true if server responds, false otherwise
 */
async function isGraphitiAvailable(): Promise<boolean> {
  // Read endpoint from .env file (same logic as prompt skill)
  const envPath = path.join(PROJECT_ROOT, '.agents', 'skills', '.env');
  let endpoint = 'http://localhost:8010/mcp/';

  try {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('GRAPHITI_ENDPOINT=')) {
          endpoint = line.slice('GRAPHITI_ENDPOINT='.length).trim();
          break;
        }
      }
    }
  } catch {
    // Use default endpoint
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'health',
        method: 'ping',
        params: {}
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok || response.status === 400; // 400 means server is up but method not found
  } catch {
    return false;
  }
}

/**
 * Store prompt to Graphiti MCP for cross-session memory
 * Graphiti's LLM automatically classifies the content as:
 * - KeyDecision, DirectionChange, ArchitecturalChoice, Preference, etc.
 * Classification happens server-side based on entity_types in config.yaml
 */
async function storeToGraphiti(prompt: string): Promise<GraphitiResult | null> {
  if (!fs.existsSync(PROMPT_SKILL_PATH)) {
    return null; // Silently skip if skill not found
  }

  // Check if Graphiti is available before attempting storage
  const available = await isGraphitiAvailable();
  if (!available) {
    return { status: 'unavailable' };
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
        // Check if it's a connection error
        const errorMsg = stderr.trim() || `exit code ${code}`;
        if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED')) {
          resolve({ status: 'unavailable' });
        } else {
          resolve({ status: 'error', error: errorMsg });
        }
      }
    });

    child.on('error', (err: Error) => {
      if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
        resolve({ status: 'unavailable' });
      } else {
        resolve({ status: 'error', error: err.message });
      }
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve({ status: 'timeout' });
    }, 5000);
  });
}

/**
 * Store prompt to Graphiti - ASYNC/NON-BLOCKING version
 * Spawns detached process and returns immediately without waiting.
 * Used to avoid blocking the user's prompt submission.
 */
function storeToGraphitiAsync(prompt: string): void {
  if (!fs.existsSync(PROMPT_SKILL_PATH)) {
    return; // Silently skip if skill not found
  }

  try {
    const child = spawn(
      'node',
      [PROMPT_SKILL_PATH, '--text', prompt, '--role', 'user', '--source', 'user-prompt'],
      {
        cwd: PROJECT_ROOT,
        detached: true, // Detach from parent process
        stdio: 'ignore', // Don't wait for I/O
      }
    );

    // Unref to allow parent to exit independently
    child.unref();
  } catch {
    // Silently ignore spawn errors - don't block the prompt
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
      if (shouldLoadPlanContext(permissionMode === 'plan')) {
        console.log('\n📋 Plan Mode - Loading Context...\n');

        // Load rules, memory, and retrospectives in parallel
        const [rules, memory, retrospectives] = await Promise.all([
          Promise.resolve(loadRulesSummary()),
          loadPlanModeMemory(),
          loadRetrospectiveMemory(),
        ]);

        if (rules) {
          console.log('📚 Project Rules Available:');
          console.log(rules);
        }

        if (retrospectives) {
          console.log('\n📝 Project Learnings (from retrospectives):');
          console.log(retrospectives);
        }

        if (memory) {
          console.log('\n🧠 Recent Memory:');
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
      storeToGraphitiAsync(prompt);

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

module.exports = { validatePrompt, enhancePrompt, logPrompt, shouldLoadPlanContext, loadRulesSummary, loadPlanModeMemory, loadRetrospectiveMemory };