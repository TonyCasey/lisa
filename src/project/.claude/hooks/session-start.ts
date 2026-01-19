#!/usr/bin/env node
export {}; // keep scope local

/**
 * Claude Code - Session Start Hook
 *
 * Loads memory context from Graphiti MCP at the start of a new Claude session.
 * This ensures Claude has access to prior work, tasks, and project context.
 *
 * Handles all SessionStart trigger types:
 * - startup: Initial session start
 * - resume: Resuming an existing session
 * - compact: After auto-compact operation (context was summarized)
 * - clear: After /clear command
 *
 * Configuration: .claude/settings.json -> hooks.SessionStart
 */

// Common modules
const { getHierarchicalGroupIds } = require('./utils/common/mcp-client');
const { detectRepo, detectBranch, getUserName, getProjectAliases } = require('./utils/common/context');
const { detectFolderMetadata, formatFolderMetadata } = require('./utils/common/group-id');
const { createHookLogger } = require('./utils/common/logger');

// Core modules (refactored)
const {
  processTasks,
  formatTaskCountsSummary,
  formatTask,
  formatTaskList,
} = require('./utils/core/task-loader');
const { loadMemoryWithTimeout, DEFAULT_MEMORY_TIMEOUT_MS } = require('./utils/core/memory-loader');

// Session modules (refactored)
const {
  getTriggerMessage,
  getTriggerReminders,
  formatTriggerLabel,
  parseTrigger,
} = require('./utils/session/trigger-handler');

// I/O modules (refactored)
const {
  readJsonStdin,
  filterRecentMemories,
  formatMemorySummary,
  formatUserSummary,
  RECENT_HOURS,
  MAX_RECENT_MEMORIES,
} = require('./utils/io');

// Types
import type { ITaskSummary, ISessionStartInput, IMemoryLoadResult } from './utils/core/types';

async function writeToStream(stream: NodeJS.WriteStream, text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const flushed = stream.write(text);
    if (flushed) {
      resolve();
      return;
    }
    stream.once('drain', resolve);
  });
}

async function flushAndExit(code: number): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  process.exit(code);
}

async function main(): Promise<void> {
  const log = createHookLogger('session-start');
  
  // Read hook input to get trigger type (startup, resume, compact, clear)
  const hookInput: ISessionStartInput = await readJsonStdin({ timeoutMs: 100 });
  const trigger = parseTrigger(hookInput.trigger, hookInput.session_type);
  
  log.info('Session start hook triggered', { trigger });

  const repo = detectRepo();
  const branch = detectBranch();
  const aliases = getProjectAliases(); // Get all aliases including folder name
  const user = getUserName();

  // Folder-based group hierarchy
  const hierarchicalGroups = getHierarchicalGroupIds();
  const folderMetadata = detectFolderMetadata();
  const folderType = formatFolderMetadata(folderMetadata);
  const cwd = process.cwd();

  log.debug('Context detected', { repo, branch, aliases, user, hierarchicalGroups });

  // Load memory with timeout to avoid blocking session start
  const memoryResult: IMemoryLoadResult = await loadMemoryWithTimeout({
    aliases,
    hierarchicalGroups,
    branch,
    timeoutMs: DEFAULT_MEMORY_TIMEOUT_MS,
  });
  
  log.debug('Memory loaded', { 
    factsCount: memoryResult.facts.length,
    nodesCount: memoryResult.nodes.length,
    tasksCount: memoryResult.tasks.length,
    timedOut: memoryResult.timedOut,
  });

  const facts = memoryResult.facts;
  const nodes = memoryResult.nodes;
  const taskNodes = memoryResult.tasks;
  const initReview = memoryResult.initReview;

  // Process tasks using the task-loader module
  const taskSummary: ITaskSummary = processTasks(taskNodes);
  const { tasks, counts, active, ready } = taskSummary;

  // Build output - show folder context with type
  const repoLabel = `${repo}${branch ? ' (' + branch + ')' : ''}`;
  const items = facts.length ? facts : nodes;

  // Filter to last 24 hours and format for display
  const recentItems = filterRecentMemories(items, RECENT_HOURS);
  const recentFormatted = formatMemorySummary(recentItems, MAX_RECENT_MEMORIES);

  const lines: string[] = [];

  // Show trigger-specific message with timeout warning if applicable
  const baseMessage = getTriggerMessage(trigger);
  if (memoryResult.timedOut) {
    lines.push(`${baseMessage.replace('.', '')} (partial - timed out after ${DEFAULT_MEMORY_TIMEOUT_MS / 1000}s).`);
  } else {
    lines.push(baseMessage);
  }

  // Add trigger-specific reminders (for compact/clear)
  const reminders = getTriggerReminders(trigger);
  if (reminders.length) {
    reminders.forEach((r: string) => lines.push(r));
  }

  // Show folder path with detected type (e.g., "TypeScript/React project")
  const folderDisplay = cwd.replace(process.env.HOME || '', '~');
  lines.push(`User: ${user} | Folder: ${folderDisplay} (${folderType})`);
  lines.push(`Repo: ${repoLabel}`);

  // Show init-review (codebase summary) if available
  if (initReview) {
    lines.push('');
    lines.push('Codebase Summary:');
    lines.push(`  ${initReview}`);
    lines.push('');
  }

  // Show recent memories from last 24 hours
  if (recentFormatted.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h):`);
    lines.push(...recentFormatted);
  } else if (items.length) {
    lines.push(`Recent memories (last ${RECENT_HOURS}h): none (older memories exist)`);
  }

  if (tasks.length) {
    // Use the formatTaskCountsSummary helper from task-loader
    lines.push(`Tasks: ${formatTaskCountsSummary(counts)}`);

    if (active.length) {
      lines.push(`Active: ${formatTask(active[0])}`);
    }
    if (ready.length) {
      lines.push(`Ready: ${formatTaskList(ready, 2)}`);
    }
  } else {
    lines.push('Tasks: none found for this repo');
  }

  // Output goes to Claude as system-reminder context (stdout)
  const output = `${lines.join('\n')}\n`;
  await writeToStream(process.stdout, output);

  // Visible confirmation to user (stderr) - use formatUserSummary helper
  const userMessage = formatUserSummary(
    items.length,
    tasks.length,
    memoryResult.timedOut,
    formatTriggerLabel(trigger)
  );
  await writeToStream(process.stderr, `${userMessage}\n`);

  // Exit cleanly - don't let open connections keep process alive
  await flushAndExit(0);
}

/**
 * Error types for distinguishing between expected and unexpected failures.
 */
class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

main().catch(async (err: Error) => {
  const log = createHookLogger('session-start');
  
  // Distinguish between error types
  const isConnectionError = err.name === 'ConnectionError' || 
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('fetch failed');
    
  const isConfigError = err.name === 'ConfigurationError' ||
    err.message.includes('API key') ||
    err.message.includes('not configured');

  if (isConnectionError) {
    // Connection errors should be visible - MCP server may not be running
    log.warn('Connection error during memory load', { error: err.message });
    await writeToStream(process.stderr, `Memory load failed (connection): ${err.message}\n`);
    await writeToStream(process.stdout, `Memory unavailable - MCP connection failed. Run 'lisa doctor' to check.\n`);
  } else if (isConfigError) {
    // Configuration errors should be visible
    log.warn('Configuration error during memory load', { error: err.message });
    await writeToStream(process.stderr, `Memory load failed (config): ${err.message}\n`);
    await writeToStream(process.stdout, `Memory unavailable - check .lisa/.env configuration.\n`);
  } else {
    // Unexpected errors - log but don't block session
    log.error('Unexpected error during memory load', { error: err.message });
    await writeToStream(process.stdout, `Memory load skipped: ${err.message}\n`);
  }
  
  // Always exit 0 to not block Claude session start
  // But the messages above make issues visible to the user
  await flushAndExit(0);
});
