import type {
  SessionTrigger,
  ILisaServices,
  ILisaContext,
  IMemoryService,
  ITaskService,
  IMcpClient,
  IMemoryItem,
  ITask,
  ITaskCounts,
  ILogger,
  IMemoryDateOptions,
} from '../../domain';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';
import {
  emptyTaskCounts,
  withCancellation,
  checkCancellation,
  isCancellationError,
} from '../../domain';
import type { ISessionStartResult } from '../interfaces';
import type { IRequestHandler } from '../mediator';
import { SessionStartRequest } from '../mediator/requests';

interface IMcpNodeResponse {
  result?: {
    nodes?: IMemoryItem[];
  };
  nodes?: IMemoryItem[];
}

/**
 * Git commit summary.
 */
interface IGitCommit {
  hash: string;
  message: string;
}

/**
 * Configuration for recent memories display.
 */
const RECENT_HOURS = 24;
const MAX_RECENT_MEMORIES = 5;
const GROUP_WINDOW_MINUTES = 5;
const MAX_GIT_COMMITS = 10;

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

/**
 * Handler for session start events.
 * Loads memory context and formats it for display.
 *
 * Implements IRequestHandler for use with the Mediator pattern.
 */
export class SessionStartHandler implements IRequestHandler<SessionStartRequest, ISessionStartResult> {
  private readonly context: ILisaContext;
  private readonly memory: IMemoryService;
  private readonly tasks: ITaskService;
  private readonly mcp: IMcpClient;
  private readonly router?: IRepositoryRouter;
  private readonly logger?: ILogger;
  private readonly githubSync?: IGitHubSyncService;

  /**
   * Create a new SessionStartHandler.
   *
   * @param services - Lisa services (legacy constructor for backward compatibility)
   */
  constructor(services: ILisaServices);

  /**
   * Create a new SessionStartHandler with individual service injection.
   *
   * @param context - Lisa context
   * @param memory - Memory service
   * @param tasks - Task service
   * @param mcp - MCP client
   * @param router - Repository router (optional)
   * @param logger - Logger (optional)
   * @param githubSync - GitHub sync service (optional)
   */
  constructor(
    context: ILisaContext,
    memory: IMemoryService,
    tasks: ITaskService,
    mcp: IMcpClient,
    router?: IRepositoryRouter,
    logger?: ILogger,
    githubSync?: IGitHubSyncService
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memory?: IMemoryService,
    tasks?: ITaskService,
    mcp?: IMcpClient,
    router?: IRepositoryRouter,
    logger?: ILogger,
    githubSync?: IGitHubSyncService
  ) {
    // Check if this is the legacy ILisaServices constructor
    if ('context' in contextOrServices && 'memory' in contextOrServices) {
      const services = contextOrServices as ILisaServices;
      this.context = services.context;
      this.memory = services.memory;
      this.tasks = services.tasks;
      this.mcp = services.mcp;
      this.router = services.router;
      this.logger = services.logger;
      this.githubSync = services.githubSync;
    } else {
      // Individual service injection
      this.context = contextOrServices as ILisaContext;
      this.memory = memory!;
      this.tasks = tasks!;
      this.mcp = mcp!;
      this.router = router;
      this.logger = logger;
      this.githubSync = githubSync;
    }
  }

  /**
   * Handle a session start request.
   */
  async handle(request: SessionStartRequest): Promise<ISessionStartResult> {
    const { hierarchicalGroupIds, projectAliases, branch, projectName, userName, folderType, projectRoot } = this.context;

    // Sync GitHub issues on startup (non-blocking, fire-and-forget for speed)
    let githubSyncResult: { imported: number; updated: number } | undefined;
    if (this.githubSync && request.trigger === 'startup') {
      try {
        // Get repo from context (format: owner/repo or just repo name)
        const repo = await this.detectGitHubRepo();
        if (repo) {
          const groupId = hierarchicalGroupIds[0] || projectName;
          this.logger?.debug('Starting GitHub sync', { repo, groupId });
          
          // Run sync with import direction (GitHub -> Lisa)
          const result = await this.githubSync.sync({
            repo,
            direction: 'import',
            groupId,
            dryRun: false,
          });
          
          githubSyncResult = {
            imported: result.imported,
            updated: result.updated,
          };
          
          this.logger?.info('GitHub sync completed', { 
            imported: result.imported, 
            updated: result.updated,
            skipped: result.skipped,
          });
        }
      } catch (error) {
        // Don't fail session start if GitHub sync fails
        this.logger?.warn('GitHub sync failed', { error: (error as Error).message });
      }
    }

    // Determine date options based on trigger
    // For startup: query from start of today for focused context
    // For resume/compact: query last 24 hours to catch recent work
    const dateOptions: IMemoryDateOptions = {};
    const now = new Date();
    if (request.trigger === 'startup') {
      // Start of today (midnight local time)
      dateOptions.since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      // Last 24 hours for resume/compact/clear
      dateOptions.since = new Date(now.getTime() - RECENT_HOURS * 60 * 60 * 1000);
    }

    // Load memory - use DAL for date-ordered facts if router is available
    let memories;
    if (this.router && this.router.isBackendAvailable('neo4j')) {
      // Use DAL with Neo4j for proper date ordering with date filtering
      memories = await this.loadMemoryWithDAL(hierarchicalGroupIds, projectAliases, branch, undefined, dateOptions);
    } else {
      // Fall back to MCP-only path
      memories = await this.memory.loadMemory(
        hierarchicalGroupIds,
        projectAliases,
        branch,
        5000 // 5 second timeout
      );
    }

    // Load recent git commits for context
    const gitCommits = await this.loadGitCommits(dateOptions.since, projectRoot);

    // Process tasks from memory
    const tasks = this.processTasks(memories.tasks);
    const taskCounts = this.countTasks(tasks);

    // Build context content
    const contextContent = this.formatContextContent(
      request.trigger,
      memories,
      tasks,
      taskCounts,
      {
        projectName,
        userName,
        folderType,
        projectRoot,
        branch,
      },
      gitCommits,
      dateOptions.since
    );

    // Build message
    const message = this.getTriggerMessage(request.trigger, memories.timedOut);

    return {
      message,
      memories,
      tasks,
      taskCounts,
      contextContent,
      timedOut: memories.timedOut,
    };
  }

  /**
   * Load memory using the DAL router for optimal date ordering.
   * Uses Neo4j for date-ordered facts, MCP for init-review and tasks.
   *
   * Uses AbortController-based cancellation to ensure no mutations
   * occur after timeout and resources are properly cleaned up.
   *
   * @param hierarchicalGroupIds - Hierarchical group IDs to query
   * @param projectAliases - Project aliases for additional queries
   * @param branch - Current git branch (optional)
   * @param signal - External abort signal for cancellation (optional)
   */
  private async loadMemoryWithDAL(
    hierarchicalGroupIds: readonly string[],
    projectAliases: readonly string[],
    branch: string | null,
    signal?: AbortSignal,
    dateOptions?: IMemoryDateOptions
  ): Promise<{ facts: IMemoryItem[]; nodes: IMemoryItem[]; tasks: IMemoryItem[]; initReview: string | null; timedOut: boolean }> {
    const memory = this.memory;
    const mcp = this.mcp;
    const result = {
      facts: [] as IMemoryItem[],
      nodes: [] as IMemoryItem[],
      tasks: [] as IMemoryItem[],
      initReview: null as string | null,
      timedOut: false,
    };

    const TIMEOUT_MS = 5000;

    // Combine hierarchical group IDs with project aliases for comprehensive search
    // This ensures we find memories stored with either naming convention
    const allGroupIds = [...new Set([...hierarchicalGroupIds, ...projectAliases])];

    const cancellableResult = await withCancellation(
      async (abortSignal) => {
        // Load init-review via MCP (semantic search for specific tag)
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before init-review');

          const initFacts = await memory.searchFacts(allGroupIds, 'init-review', 1);

          checkCancellation(abortSignal, 'Memory load cancelled after init-review fetch');

          const initFact = initFacts.find((f) => f.tags?.includes('type:init-review'));
          if (initFact) {
            result.initReview = initFact.fact || initFact.name || null;
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if init-review load fails
        }

        // Load facts using DAL with date ordering (Neo4j preferred)
        // Use date options if provided, otherwise load all recent facts
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before facts');

          const facts = await memory.loadFactsDateOrdered(allGroupIds, 100, dateOptions);

          checkCancellation(abortSignal, 'Memory load cancelled after facts fetch');

          result.facts = facts;
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if fact load fails
        }

        // Fall back to nodes when no facts are found (preserve MCP behavior)
        if (!result.facts.length) {
          try {
            const seenUuids = new Set<string>();

            for (const alias of projectAliases) {
              checkCancellation(abortSignal, 'Memory load cancelled during node iteration');

              const nodeParams = {
                query: alias,
                tags: this.buildRepoTags(alias, branch),
                max_nodes: 20,
                group_ids: [...allGroupIds],
              };
              const [nodeResp] = await mcp.call<IMcpNodeResponse>('search_nodes', nodeParams);

              checkCancellation(abortSignal, 'Memory load cancelled after nodes fetch');

              const aliasedNodes = nodeResp?.result?.nodes || nodeResp?.nodes || [];
              for (const node of aliasedNodes) {
                const uuid = node.uuid || `${node.name}-${node.fact}`;
                if (!seenUuids.has(uuid)) {
                  seenUuids.add(uuid);
                  result.nodes.push(node);
                }
              }
            }
          } catch (error) {
            if (isCancellationError(error)) throw error;
            // Continue if node load fails
          }
        }

        // Load tasks via DAL (uses Neo4j when available for date ordering)
        try {
          checkCancellation(abortSignal, 'Memory load cancelled before tasks');

          const loadedTasks = await this.tasks.getTasksSimple(allGroupIds);

          checkCancellation(abortSignal, 'Memory load cancelled after tasks fetch');

          // Convert ITask[] to IMemoryItem[] format for compatibility
          for (const task of loadedTasks) {
            result.tasks.push({
              uuid: task.key,
              name: task.title,
              fact: task.title,
              tags: [
                'type:task',
                `task_id:${task.key}`,
                `status:${task.status}`,
                ...(task.blocked || []).map((b: string) => `blocked_by:${b}`),
              ],
              created_at: task.created_at,
            });
          }
        } catch (error) {
          if (isCancellationError(error)) throw error;
          // Continue if task load fails
        }

        return result;
      },
      {
        timeoutMs: TIMEOUT_MS,
        signal,
        onCancel: () => {
          this.logger?.debug('Memory load with DAL cancelled');
        },
      }
    );

    result.timedOut = cancellableResult.timedOut;

    return result;
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
      reminders.push('Use /memory to recall prior work or /lisa for context');
    }
    return reminders;
  }

  /**
   * Process task nodes into structured tasks.
   */
  private processTasks(taskNodes: readonly IMemoryItem[]): ITask[] {
    const tasksByKey = new Map<string, IMemoryItem>();

    for (const node of taskNodes) {
      const key = this.getTaskNum(node.tags) || this.getTaskId(node.tags);
      if (!key) continue;

      const existing = tasksByKey.get(key);
      const latest = existing ? this.pickLatest(existing, node) : node;
      tasksByKey.set(key, latest);
    }

    const tasks: ITask[] = Array.from(tasksByKey.entries()).map(([key, n]) => ({
      key,
      status: this.getTaskStatus(n.tags),
      title: n.name || n.fact || n.uuid || '<untitled>',
      blocked: (n.tags || [])
        .filter((t) => t.startsWith('blocked_by:'))
        .map((t) => t.replace('blocked_by:', '')),
      created_at: n.created_at,
    }));

    // Sort by creation date descending
    tasks.sort((a, b) => {
      const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bd - ad;
    });

    return tasks;
  }

  /**
   * Count tasks by status.
   */
  private countTasks(tasks: readonly ITask[]): ITaskCounts {
    const counts = { ...emptyTaskCounts() };
    for (const task of tasks) {
      const key = task.status in counts ? task.status : 'unknown';
      (counts as Record<string, number>)[key] += 1;
    }
    return counts;
  }

  /**
   * Format the full context content for injection.
   */
  private formatContextContent(
    trigger: SessionTrigger,
    memories: { facts: readonly IMemoryItem[]; nodes: readonly IMemoryItem[]; initReview: string | null; timedOut: boolean },
    tasks: readonly ITask[],
    taskCounts: ITaskCounts,
    context: {
      projectName: string;
      userName: string;
      folderType: string;
      projectRoot: string;
      branch: string | null;
    },
    gitCommits: readonly IGitCommit[] = [],
    querySince?: Date
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

  // --- Helper methods extracted from original hook ---

  /**
   * Load recent git commits for context.
   * @param since - Date to start from
   * @param projectRoot - Project root directory
   * @returns Array of commit summaries
   */
  private async loadGitCommits(since: Date | undefined, projectRoot: string): Promise<IGitCommit[]> {
    if (!since) return [];
    
    try {
      const { execSync } = await import('child_process');
      const sinceArg = since.toISOString().split('T')[0]; // YYYY-MM-DD format
      const output = execSync(
        `git log --since="${sinceArg}" --oneline --format="%h %s" -${MAX_GIT_COMMITS}`,
        { 
          encoding: 'utf8',
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();
      
      if (!output) return [];
      
      return output.split('\n').filter(Boolean).map(line => {
        const spaceIndex = line.indexOf(' ');
        return {
          hash: line.slice(0, spaceIndex),
          message: line.slice(spaceIndex + 1),
        };
      });
    } catch {
      // Git not available or not a git repo - that's fine
      return [];
    }
  }

  /**
   * Detect the GitHub repository from git remote.
   * Returns owner/repo format or null if not a GitHub repo.
   */
  private async detectGitHubRepo(): Promise<string | null> {
    try {
      const { execSync } = await import('child_process');
      const remote = execSync('git remote get-url origin', { 
        encoding: 'utf8',
        cwd: this.context.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      
      // Parse GitHub URL formats:
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/.]+)/);
      const sshMatch = remote.match(/github\.com:([^/]+\/[^/.]+)/);
      
      const match = httpsMatch || sshMatch;
      if (match) {
        return match[1].replace(/\.git$/, '');
      }
      return null;
    } catch {
      return null;
    }
  }

  private getTaskId(tags: readonly string[] = []): string | null {
    const t = tags.find((x) => x.startsWith('task_id:'));
    return t ? t.replace('task_id:', '') : null;
  }

  private getTaskNum(tags: readonly string[] = []): string | null {
    const t = tags.find((x) => x.startsWith('task_num:'));
    return t ? t.replace('task_num:', '') : null;
  }

  private getTaskStatus(tags: readonly string[] = []): ITask['status'] {
    const t = tags.find((x) => x.startsWith('status:'));
    const status = t ? t.replace('status:', '').toLowerCase() : 'unknown';
    const validStatuses = ['ready', 'in-progress', 'blocked', 'done', 'closed', 'unknown'];
    return validStatuses.includes(status) ? (status as ITask['status']) : 'unknown';
  }

  private pickLatest(a: IMemoryItem, b: IMemoryItem): IMemoryItem {
    const ad = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bd = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bd > ad ? b : a;
  }

  private buildRepoTags(repo: string, branch: string | null): string[] {
    const tags: string[] = [];
    if (repo) tags.push(`repo:${repo}`);
    if (branch) tags.push(`branch:${branch}`);
    return tags;
  }

  private filterRecentMemories(memories: readonly IMemoryItem[], hoursAgo: number): IMemoryItem[] {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return memories.filter((m) => {
      if (!m.created_at) return false;
      const created = new Date(m.created_at);
      if (created < cutoff) return false;
      if (m.name && EXCLUDED_RELATIONSHIPS.has(m.name)) return false;
      return true;
    });
  }

  private formatMemorySummary(memories: readonly IMemoryItem[], limit: number): string[] {
    const groups = this.groupMemoriesByTime(memories, GROUP_WINDOW_MINUTES);
    const topGroups = groups.slice(0, limit);
    return topGroups.map((group) => {
      const dateStr = this.formatRelativeDate(group.timestamp);
      return `  ${dateStr} - ${group.summary}`;
    });
  }

  private groupMemoriesByTime(
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

  private extractGroupSummary(memories: IMemoryItem[]): string {
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
  private formatDateRangeDescription(since: Date): string {
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

  private formatRelativeDate(date: Date): string {
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
