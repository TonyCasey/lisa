/**
 * Session Start Hook Handler
 * 
 * CLI command: lisa hook session-start
 * 
 * Loads memory context from storage at the start of a Claude Code session.
 * Reads JSON from stdin, outputs context to stdout.
 */

import type { Readable, Writable } from 'stream';
import type { ISessionStartHookInput, ISessionStartHookOutput, SessionTrigger } from './types';
import { parseTrigger } from './types';
import {
  readJsonStdin,
  writeJsonStdout,
  writeToStream,
  getHookConfig,
  detectRepo,
  detectBranch,
  getUserName,
  getHierarchicalGroupIds,
} from './utils';

/**
 * Configuration for recent memories display.
 */
const RECENT_HOURS = 24;
const MAX_RECENT_MEMORIES = 5;

/**
 * Handler for session start events via CLI.
 */
export class SessionStartHookHandler {
  /**
   * Execute the hook handler.
   * Reads from stdin, writes context to stdout, status to stderr.
   */
  async execute(
    stdin: Readable = process.stdin,
    stdout: Writable = process.stdout,
    stderr: Writable = process.stderr
  ): Promise<void> {
    try {
      // 1. Read hook input from stdin
      const input = await readJsonStdin<ISessionStartHookInput>(stdin);
      const trigger = parseTrigger(input.source, input.session_type);

      // 2. Gather context information
      const repo = detectRepo();
      const branch = detectBranch();
      const user = getUserName();
      const hierarchicalGroups = getHierarchicalGroupIds();
      const cwd = input.cwd || process.cwd();
      const config = getHookConfig();

      // 3. Load memory from storage
      const memoryResult = await this.loadMemory(hierarchicalGroups, config);

      // 4. Build context content
      const contextContent = this.buildContextContent(trigger, {
        repo,
        branch,
        user,
        cwd,
        memories: memoryResult.facts,
        tasks: memoryResult.tasks,
        initReview: memoryResult.initReview,
        timedOut: memoryResult.timedOut,
      });

      // 5. Output context to stdout (goes to Claude)
      const output: ISessionStartHookOutput = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: contextContent,
        },
      };
      await writeJsonStdout(output, stdout);

      // 6. Status message to stderr (shown to user)
      const statusMessage = this.buildStatusMessage(trigger, memoryResult);
      await writeToStream(stderr, `${statusMessage}\n`);
    } catch (error) {
      // On error, still output something to not block session
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const output: ISessionStartHookOutput = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `Memory load skipped: ${errorMessage}`,
        },
      };
      await writeJsonStdout(output, stdout);
      await writeToStream(stderr, `Memory load failed: ${errorMessage}\n`);
    }
  }

  /**
   * Load memory from storage (MCP or Zep Cloud).
   */
  private async loadMemory(
    groupIds: string[],
    _config: ReturnType<typeof getHookConfig>
  ): Promise<{
    facts: Array<{ name: string; fact: string; created_at?: string; tags?: string[] }>;
    tasks: Array<{ name: string; fact: string; tags?: string[] }>;
    initReview: string | null;
    timedOut: boolean;
  }> {
    const result = {
      facts: [] as Array<{ name: string; fact: string; created_at?: string; tags?: string[] }>,
      tasks: [] as Array<{ name: string; fact: string; tags?: string[] }>,
      initReview: null as string | null,
      timedOut: false,
    };

    const TIMEOUT_MS = 5000;
    let timedOut = false;

    const loadPromise = async (): Promise<void> => {
      // Try to load via lisa memory command
      try {
        const { execSync } = require('child_process');
        const groupArg = groupIds[0] || 'default';
        
        // Load facts
        const factsJson = execSync(
          `lisa memory load --group "${groupArg}" --limit 50 --cache 2>/dev/null`,
          { encoding: 'utf8', timeout: TIMEOUT_MS }
        );
        
        try {
          const parsed = JSON.parse(factsJson);
          if (Array.isArray(parsed.facts)) {
            result.facts = parsed.facts;
          } else if (Array.isArray(parsed)) {
            result.facts = parsed;
          }
          
          // Extract init-review if present
          const initFact = result.facts.find(f => f.tags?.includes('type:init-review'));
          if (initFact) {
            result.initReview = initFact.fact || initFact.name || null;
          }
          
          // Extract tasks
          result.tasks = result.facts.filter(f => f.tags?.includes('type:task'));
        } catch {
          // JSON parse failed, continue with empty results
        }
      } catch {
        // Command failed, continue with empty results
      }
    };

    // Race between loading and timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, TIMEOUT_MS);
    });

    await Promise.race([loadPromise(), timeoutPromise]);
    result.timedOut = timedOut;

    return result;
  }

  /**
   * Build the context content string for Claude.
   */
  private buildContextContent(
    trigger: SessionTrigger,
    context: {
      repo: string;
      branch: string | null;
      user: string;
      cwd: string;
      memories: Array<{ name: string; fact: string; created_at?: string }>;
      tasks: Array<{ name: string; fact: string; tags?: string[] }>;
      initReview: string | null;
      timedOut: boolean;
    }
  ): string {
    const { repo, branch, user, cwd, memories, tasks, initReview, timedOut } = context;
    const lines: string[] = [];

    // Trigger message
    lines.push(this.getTriggerMessage(trigger, timedOut));

    // Reminders for special triggers
    const reminders = this.getTriggerReminders(trigger);
    reminders.forEach(r => lines.push(r));

    // Context info
    const folderDisplay = cwd.replace(process.env.HOME || '', '~');
    lines.push(`User: ${user} | Folder: ${folderDisplay}`);
    lines.push(`Repo: ${repo}${branch ? ' (' + branch + ')' : ''}`);

    // Init review (codebase summary)
    if (initReview) {
      lines.push('');
      lines.push('Codebase Summary:');
      lines.push(`  ${initReview}`);
      lines.push('');
    }

    // Recent memories
    const recentMemories = this.filterRecentMemories(memories, RECENT_HOURS);
    if (recentMemories.length > 0) {
      lines.push(`Recent memories (last ${RECENT_HOURS}h):`);
      recentMemories.slice(0, MAX_RECENT_MEMORIES).forEach(m => {
        lines.push(`  - ${m.fact || m.name}`);
      });
    } else if (memories.length > 0) {
      lines.push(`Recent memories (last ${RECENT_HOURS}h): none (older memories exist)`);
    }

    // Tasks
    if (tasks.length > 0) {
      const tasksByStatus = this.groupTasksByStatus(tasks);
      const summaryParts: string[] = [];
      if (tasksByStatus['in-progress']) summaryParts.push(`${tasksByStatus['in-progress'].length} in-progress`);
      if (tasksByStatus['ready']) summaryParts.push(`${tasksByStatus['ready'].length} ready`);
      if (tasksByStatus['blocked']) summaryParts.push(`${tasksByStatus['blocked'].length} blocked`);
      if (tasksByStatus['done']) summaryParts.push(`${tasksByStatus['done'].length} done`);
      
      lines.push(`Tasks: ${summaryParts.join(', ') || 'none active'}`);

      const active = tasksByStatus['in-progress'] || [];
      if (active.length > 0) {
        lines.push(`Active: ${active[0].fact || active[0].name}`);
      }
    } else {
      lines.push('Tasks: none found for this repo');
    }

    return lines.join('\n');
  }

  /**
   * Get trigger-specific message.
   */
  private getTriggerMessage(trigger: SessionTrigger, timedOut: boolean): string {
    const messages: Record<SessionTrigger, string> = {
      startup: 'Memory loaded for session start.',
      resume: 'Memory loaded for session resume.',
      compact: 'Memory reloaded after context compaction.',
      clear: 'Memory loaded after context clear.',
    };

    const base = messages[trigger] || messages.startup;
    return timedOut ? base.replace('.', ' (partial - timed out).') : base;
  }

  /**
   * Get trigger-specific reminders.
   */
  private getTriggerReminders(trigger: SessionTrigger): string[] {
    const reminders: string[] = [];
    if (trigger === 'compact') {
      reminders.push('Note: Context was compacted. Previously loaded skills may need to be re-invoked if needed.');
    }
    if (trigger === 'clear') {
      reminders.push('Note: Context was cleared. Start fresh or use /memory to recall prior work.');
    }
    return reminders;
  }

  /**
   * Filter memories to recent time window.
   */
  private filterRecentMemories(
    memories: Array<{ name: string; fact: string; created_at?: string }>,
    hoursAgo: number
  ): Array<{ name: string; fact: string; created_at?: string }> {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return memories.filter(m => {
      if (!m.created_at) return false;
      const created = new Date(m.created_at);
      return created >= cutoff;
    });
  }

  /**
   * Group tasks by status.
   */
  private groupTasksByStatus(
    tasks: Array<{ name: string; fact: string; tags?: string[] }>
  ): Record<string, Array<{ name: string; fact: string; tags?: string[] }>> {
    const groups: Record<string, Array<{ name: string; fact: string; tags?: string[] }>> = {};
    
    for (const task of tasks) {
      const statusTag = task.tags?.find(t => t.startsWith('status:'));
      const status = statusTag ? statusTag.replace('status:', '') : 'unknown';
      
      if (!groups[status]) {
        groups[status] = [];
      }
      groups[status].push(task);
    }
    
    return groups;
  }

  /**
   * Build status message for user (stderr).
   */
  private buildStatusMessage(
    trigger: SessionTrigger,
    result: { facts: unknown[]; tasks: unknown[]; timedOut: boolean }
  ): string {
    const triggerLabels: Record<SessionTrigger, string> = {
      startup: 'session start',
      resume: 'session resume',
      compact: 'context compact',
      clear: 'context clear',
    };
    
    const label = triggerLabels[trigger] || 'session';
    const timeoutSuffix = result.timedOut ? ' (partial)' : '';
    
    return `Lisa: ${result.facts.length} memories, ${result.tasks.length} tasks loaded for ${label}${timeoutSuffix}`;
  }
}
