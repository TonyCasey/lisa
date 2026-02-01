/**
 * SessionContextFormatter
 *
 * Formats session context content for display during session start.
 * Extracted from SessionStartHandler to enable unit testing of
 * formatting logic without MCP/DAL/git dependencies.
 */

import type {
  SessionTrigger,
  IMemoryItem,
  ITask,
  ITaskCounts,
  IProjectContext,
} from '../../domain';

/**
 * Git commit summary used in context display.
 */
export interface IGitCommit {
  hash: string;
  message: string;
}

/**
 * Session context information for formatting.
 */
export interface ISessionContext {
  projectName: string;
  userName: string;
  folderType: string;
  projectRoot: string;
  branch: string | null;
}

/**
 * Memory data used for context formatting.
 */
export interface IFormattableMemories {
  readonly facts: readonly IMemoryItem[];
  readonly nodes: readonly IMemoryItem[];
  readonly initReview: string | null;
  readonly timedOut: boolean;
}

/**
 * Configuration for recent memories display.
 */
const RECENT_HOURS = 24;
const MAX_RECENT_MEMORIES = 5;
const GROUP_WINDOW_MINUTES = 5;

/**
 * Low-level relationship types to exclude (system noise).
 */
const EXCLUDED_RELATIONSHIPS = new Set([
  'USER_SUBMITS_DIRECTION',
  'DIRECTION_IS_TOPIC',
  'EXPANDED_ENTITY_TYPES_TRACKED',
  'TESTS',
  'ASSESSES',
]);

export class SessionContextFormatter {
  /**
   * Get trigger-specific message.
   */
  getTriggerMessage(trigger: SessionTrigger, timedOut: boolean): string {
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
  getTriggerReminders(trigger: SessionTrigger): string[] {
    const reminders: string[] = [];
    if (trigger === 'compact') {
      reminders.push('Available skills: /memory, /tasks, /lisa, /jira, /git, /pr');
      reminders.push(
        'Rules loaded from .lisa/rules/ (coding standards, clean architecture, git workflow, testing)',
      );
      reminders.push('Use /memory to recall topics or ask Lisa for help');
    }
    if (trigger === 'clear') {
      reminders.push(
        'Fresh session started. Available skills: /memory, /tasks, /lisa, /jira, /git, /pr',
      );
      reminders.push(
        'Rules loaded from .lisa/rules/ (coding standards, clean architecture, git workflow, testing)',
      );
      reminders.push('Use /memory to recall prior work or /lisa for context');
    }
    return reminders;
  }

  /**
   * Format the full context content for injection into session context.
   */
  formatContextContent(
    trigger: SessionTrigger,
    memories: IFormattableMemories,
    tasks: readonly ITask[],
    taskCounts: ITaskCounts,
    context: ISessionContext,
    gitCommits: readonly IGitCommit[] = [],
    querySince?: Date,
    projectContext?: IProjectContext,
  ): string {
    const { projectName, userName, folderType, projectRoot, branch } = context;
    const lines: string[] = [];

    // Trigger message
    lines.push(this.getTriggerMessage(trigger, memories.timedOut));

    // Show query date range if applicable
    if (querySince) {
      const rangeDesc = this.formatDateRangeDescription(querySince);
      lines.push(`Context range: ${rangeDesc}`);
    }

    // Reminders
    const reminders = this.getTriggerReminders(trigger);
    reminders.forEach((r) => lines.push(r));

    // Context info
    const folderDisplay = projectRoot.replace(process.env.HOME || process.env.USERPROFILE || '', '~');
    lines.push(`User: ${userName} | Folder: ${folderDisplay} (${folderType})`);
    lines.push(`Repo: ${projectName}${branch ? ' (' + branch + ')' : ''}`);

    // Project context (structured knowledge)
    if (projectContext) {
      lines.push('');
      lines.push('Project context:');
      if (projectContext.techStack.length) {
        const stack = truncateList(projectContext.techStack, 3);
        lines.push(`  Stack: ${stack}`);
      }
      if (projectContext.keyDecisions.length) {
        const decisions = truncateList(projectContext.keyDecisions, 3);
        lines.push(`  Decisions: ${decisions}`);
      }
      if (projectContext.activeConstraints.length) {
        const constraints = truncateList(projectContext.activeConstraints, 3);
        lines.push(`  Constraints: ${constraints}`);
      }
      if (projectContext.conventions.length) {
        const conventions = truncateList(projectContext.conventions, 3);
        lines.push(`  Conventions: ${conventions}`);
      }
    }

    // Init review (codebase summary)
    if (memories.initReview) {
      lines.push('');
      lines.push('Codebase Summary:');
      lines.push(`  ${memories.initReview}`);
      lines.push('');
    }

    // Recent git commits
    if (gitCommits.length > 0) {
      lines.push('');
      lines.push(`Recent commits (${gitCommits.length}):`);
      gitCommits.slice(0, 5).forEach(c => {
        lines.push(`  ${c.hash} ${c.message}`);
      });
      if (gitCommits.length > 5) {
        lines.push(`  ... and ${gitCommits.length - 5} more`);
      }
    }

    // Recent memories
    const items = memories.facts.length ? memories.facts : memories.nodes;
    const recentItems = this.filterRecentMemories(items, RECENT_HOURS);
    const recentFormatted = this.formatMemorySummary(recentItems, MAX_RECENT_MEMORIES);

    if (recentFormatted.length) {
      lines.push('');
      lines.push(`Recent memories (last ${RECENT_HOURS}h):`);
      lines.push(...recentFormatted);
    } else if (items.length) {
      lines.push(`Recent memories (last ${RECENT_HOURS}h): none (older memories exist)`);
    }

    // Tasks
    if (tasks.length) {
      lines.push('');
      const summaryParts: string[] = [];
      if (taskCounts['in-progress']) summaryParts.push(`${taskCounts['in-progress']} in-progress`);
      if (taskCounts.ready) summaryParts.push(`${taskCounts.ready} ready`);
      if (taskCounts.blocked) summaryParts.push(`${taskCounts.blocked} blocked`);
      if (taskCounts.done) summaryParts.push(`${taskCounts.done} done`);
      if (taskCounts.closed) summaryParts.push(`${taskCounts.closed} closed`);
      lines.push(`Tasks: ${summaryParts.join(', ') || 'none active'}`);

      const active = tasks.filter((t) => t.status === 'in-progress');
      const ready = tasks.filter((t) => t.status === 'ready');

      if (active.length) {
        lines.push(`Active: ${active[0].key} - ${active[0].title}`);
      }
      if (ready.length) {
        const readyList = ready
          .slice(0, 2)
          .map((t) => `${t.key} - ${t.title}`)
          .join(' | ');
        lines.push(`Ready: ${readyList}`);
      }
    } else {
      lines.push('Tasks: none found for this repo');
    }

    return lines.join('\n');
  }

  /**
   * Filter memories to recent items within a time window.
   */
  filterRecentMemories(memories: readonly IMemoryItem[], hoursAgo: number): IMemoryItem[] {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return memories.filter((m) => {
      if (!m.created_at) return false;
      const created = new Date(m.created_at);
      if (created < cutoff) return false;
      if (m.name && EXCLUDED_RELATIONSHIPS.has(m.name)) return false;
      return true;
    });
  }

  /**
   * Format memory items into grouped summary lines.
   */
  formatMemorySummary(memories: readonly IMemoryItem[], limit: number): string[] {
    const groups = this.groupMemoriesByTime(memories, GROUP_WINDOW_MINUTES);
    const topGroups = groups.slice(0, limit);
    return topGroups.map((group) => {
      const dateStr = this.formatRelativeDate(group.timestamp);
      return `  ${dateStr} - ${group.summary}`;
    });
  }

  /**
   * Group memories by time windows for compact display.
   */
  groupMemoriesByTime(
    memories: readonly IMemoryItem[],
    windowMinutes: number
  ): Array<{ timestamp: Date; memories: IMemoryItem[]; summary: string }> {
    if (!memories.length) return [];

    const sorted = [...memories].sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });

    const groups: Array<{ timestamp: Date; memories: IMemoryItem[]; summary: string }> = [];
    let currentGroup: IMemoryItem[] = [];
    let groupStartTime: number | null = null;

    for (const memory of sorted) {
      const memTime = memory.created_at ? new Date(memory.created_at).getTime() : 0;

      if (groupStartTime === null) {
        groupStartTime = memTime;
        currentGroup = [memory];
      } else if (groupStartTime - memTime <= windowMinutes * 60 * 1000) {
        currentGroup.push(memory);
      } else {
        groups.push({
          timestamp: new Date(groupStartTime),
          memories: currentGroup,
          summary: this.extractGroupSummary(currentGroup),
        });
        groupStartTime = memTime;
        currentGroup = [memory];
      }
    }

    if (currentGroup.length && groupStartTime !== null) {
      groups.push({
        timestamp: new Date(groupStartTime),
        memories: currentGroup,
        summary: this.extractGroupSummary(currentGroup),
      });
    }

    return groups;
  }

  /**
   * Extract a concise summary from a group of related memories.
   */
  extractGroupSummary(memories: IMemoryItem[]): string {
    if (memories.length === 1) {
      return memories[0].fact || memories[0].name || '<unknown>';
    }

    const facts = memories.map((m) => m.fact || m.name || '').filter(Boolean);
    if (!facts.length) return `${memories.length} items`;

    const words = facts[0].split(/\s+/);
    let commonPrefix = '';

    for (let i = 0; i < Math.min(words.length, 8); i++) {
      const prefix = words.slice(0, i + 1).join(' ');
      const allMatch = facts.every((f) => f.startsWith(prefix));
      if (allMatch) {
        commonPrefix = prefix;
      } else {
        break;
      }
    }

    commonPrefix = commonPrefix.replace(
      /\s+(the|a|an|is|are|was|were|includes?|has|have|with|for|to|of|in|on|at)$/i,
      ''
    );

    if (commonPrefix.length > 15) {
      return `${commonPrefix} (${memories.length} items)`;
    }

    const firstFact = facts[0];
    if (firstFact.length > 60) {
      return `${firstFact.slice(0, 57)}... (+${memories.length - 1} more)`;
    }
    return `${firstFact} (+${memories.length - 1} more)`;
  }

  /**
   * Format a date range description for display.
   */
  formatDateRangeDescription(since: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sinceDay = new Date(since.getFullYear(), since.getMonth(), since.getDate());

    if (sinceDay.getTime() === today.getTime()) {
      return 'today';
    }

    const hoursAgo = Math.round((now.getTime() - since.getTime()) / (1000 * 60 * 60));
    if (hoursAgo <= 24) {
      return `last ${hoursAgo}h`;
    }

    const daysAgo = Math.round(hoursAgo / 24);
    return `last ${daysAgo} day${daysAgo > 1 ? 's' : ''}`;
  }

  /**
   * Format a date as a relative display string.
   */
  formatRelativeDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    if (dateOnly.getTime() === today.getTime()) {
      return `Today ${time}`;
    } else if (dateOnly.getTime() === yesterday.getTime()) {
      return `Yesterday ${time}`;
    } else {
      const month = date.toLocaleString('en-US', { month: 'short' });
      const day = date.getDate();
      return `${month} ${day} ${time}`;
    }
  }
}

/**
 * Truncate a list to a maximum number of items with "+N more" suffix.
 */
function truncateList(items: readonly string[], max: number): string {
  if (items.length <= max) return items.join(', ');
  const shown = items.slice(0, max).join(', ');
  return `${shown} (+${items.length - max} more)`;
}
