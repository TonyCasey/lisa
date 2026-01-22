#!/usr/bin/env node
/**
 * Session Stop Worker
 * 
 * Background worker that captures session work to memory.
 * Spawned by SessionStopHookHandler to run asynchronously.
 * 
 * Usage: node session-stop-worker.js '<json-input>'
 * 
 * Input JSON: { session_id, transcript_path, cwd }
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

interface IWorkerInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

interface ITranscriptMessage {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  summary?: string;
}

interface IWorkSummary {
  messageCount: number;
  userPrompts: number;
  assistantResponses: number;
  toolCalls: number;
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  summary: string;
}

const MEMORY_TIMEOUT_MS = 10000;
const MIN_MESSAGES_FOR_CAPTURE = 3;

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  try {
    // 1. Parse input from CLI argument
    const inputArg = process.argv[2];
    if (!inputArg) {
      logDebug('No input provided to worker');
      process.exit(0);
    }

    let input: IWorkerInput;
    try {
      input = JSON.parse(inputArg);
    } catch {
      logDebug('Invalid JSON input');
      process.exit(0);
    }

    // 2. Change to working directory
    if (input.cwd && fs.existsSync(input.cwd)) {
      process.chdir(input.cwd);
    }

    // 3. Find and parse transcript
    const transcriptPath = findTranscript(input.transcript_path);
    if (!transcriptPath) {
      logDebug('Transcript not found');
      process.exit(0);
    }

    const work = parseTranscript(transcriptPath);

    // 4. Check if there was meaningful work
    if (!hasSignificantWork(work)) {
      logDebug('No significant work to capture');
      process.exit(0);
    }

    // 5. Save to memory
    await saveToMemory(work, input);

    process.exit(0);
  } catch (err) {
    logDebug(`Worker error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Find the transcript file.
 */
function findTranscript(providedPath: string): string | null {
  // Try provided path first
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }

  // Try common locations
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const possiblePaths = [
    path.join(homeDir, '.claude', 'projects', '**', 'transcript.jsonl'),
    path.join(homeDir, '.claude', 'transcript.jsonl'),
  ];

  for (const p of possiblePaths) {
    // Simple glob-free check for the most common case
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f === 'transcript.jsonl');
      if (files.length > 0) {
        return path.join(dir, files[0]);
      }
    }
  }

  return null;
}

/**
 * Parse transcript file to extract work summary.
 */
function parseTranscript(transcriptPath: string): IWorkSummary {
  const content = fs.readFileSync(transcriptPath, 'utf8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  let userPrompts = 0;
  let assistantResponses = 0;
  let toolCalls = 0;
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  let firstTimestamp = 0;
  let lastTimestamp = 0;
  let summaryText = '';

  for (const line of lines) {
    try {
      const msg: ITranscriptMessage = JSON.parse(line);

      // Track message types
      if (msg.type === 'user' || msg.message?.role === 'user') {
        userPrompts++;
      } else if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
        assistantResponses++;

        // Extract summary from last assistant message
        const content = msg.message?.content;
        if (typeof content === 'string') {
          summaryText = content.slice(0, 500);
        } else if (Array.isArray(content)) {
          const textBlock = content.find(c => c.type === 'text');
          if (textBlock?.text) {
            summaryText = textBlock.text.slice(0, 500);
          }
        }
      } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
        toolCalls++;
      }

      // Track file operations (simplified detection)
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
    }
  }

  return {
    messageCount: lines.length,
    userPrompts,
    assistantResponses,
    toolCalls,
    filesCreated: [...new Set(filesCreated)],
    filesModified: [...new Set(filesModified)],
    duration: lastTimestamp && firstTimestamp ? lastTimestamp - firstTimestamp : 0,
    summary: summaryText,
  };
}

/**
 * Check if there's significant work to capture.
 */
function hasSignificantWork(work: IWorkSummary): boolean {
  // Need at least a few messages
  if (work.messageCount < MIN_MESSAGES_FOR_CAPTURE) {
    return false;
  }

  // Need some actual interaction
  if (work.userPrompts < 1 || work.assistantResponses < 1) {
    return false;
  }

  // Bonus: file changes indicate real work
  if (work.filesCreated.length > 0 || work.filesModified.length > 0) {
    return true;
  }

  // Bonus: tool usage indicates real work
  if (work.toolCalls > 2) {
    return true;
  }

  // Basic threshold
  return work.messageCount >= 5;
}

/**
 * Save work summary to memory via lisa CLI.
 */
async function saveToMemory(work: IWorkSummary, input: IWorkerInput): Promise<void> {
  const repo = detectRepo();

  // Build summary text
  const parts: string[] = [];
  parts.push(`Session ${input.session_id.slice(0, 8)}:`);
  parts.push(`${work.userPrompts} prompts, ${work.assistantResponses} responses`);
  
  if (work.toolCalls > 0) {
    parts.push(`${work.toolCalls} tool calls`);
  }
  
  if (work.filesCreated.length > 0) {
    parts.push(`Created: ${work.filesCreated.slice(0, 3).join(', ')}${work.filesCreated.length > 3 ? '...' : ''}`);
  }
  
  if (work.filesModified.length > 0) {
    parts.push(`Modified: ${work.filesModified.slice(0, 3).join(', ')}${work.filesModified.length > 3 ? '...' : ''}`);
  }

  if (work.summary) {
    // Add truncated summary
    const shortSummary = work.summary.slice(0, 200).replace(/\n/g, ' ').trim();
    if (shortSummary) {
      parts.push(`Summary: ${shortSummary}...`);
    }
  }

  const summary = parts.join('. ');

  // Check if lisa CLI is available
  if (!isLisaAvailable()) {
    logDebug('Lisa CLI not available, skipping memory capture');
    return;
  }

  return new Promise((resolve) => {
    const args = [
      'memory',
      'add',
      summary,
      '--group',
      repo || 'default',
      '--tag',
      'type:session-capture',
      '--tag',
      `session:${input.session_id.slice(0, 8)}`,
    ];

    const child = spawn('lisa', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: true,
    });

    const timeout = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve();
    }, MEMORY_TIMEOUT_MS);

    child.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.on('error', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/**
 * Detect repository name from git.
 */
function detectRepo(): string {
  try {
    const url = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : getProjectName();
  } catch {
    return getProjectName();
  }
}

/**
 * Get project name from package.json or directory.
 */
function getProjectName(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch { /* ignore */ }
  return path.basename(process.cwd());
}

/**
 * Check if lisa CLI is available.
 */
function isLisaAvailable(): boolean {
  try {
    execSync('lisa --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Debug logging (only when DEBUG env is set).
 */
function logDebug(message: string): void {
  if (process.env.DEBUG || process.env.LOG_LEVEL === 'debug') {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] session-stop-worker: ${message}`);
  }
}

// Global error handlers
process.on('uncaughtException', (err: Error) => {
  logDebug(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logDebug(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main();
}

export { main, parseTranscript, hasSignificantWork, saveToMemory };
