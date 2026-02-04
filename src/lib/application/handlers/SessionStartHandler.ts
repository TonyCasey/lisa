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
  IGitClient,
  IGitTriageService,
  ITriageResult,
  IScoredCommit,
  ICommitEnricher,
} from '../../domain';
import type { IRepositoryRouter } from '../../domain/interfaces/dal';
import type { IGitHubSyncService } from '../../skills/shared/services/GitHubSyncService';
import { emptyTaskCounts } from '../../domain';
import type { ISessionStartResult } from '../interfaces';
import type { IRequestHandler } from '../mediator';
import { SessionStartRequest } from '../mediator/requests';
import { SessionContextFormatter } from '../services/SessionContextFormatter';
import { GitIntrospectionService } from '../services/GitIntrospectionService';
import { MemoryContextLoader } from '../services/MemoryContextLoader';
import { GitTriageService } from '../services/GitTriageService';

/**
 * Configuration for recent memories display.
 */
const RECENT_HOURS = 24;

/**
 * Handler for session start events.
 *
 * Orchestrates memory loading, git introspection, task processing,
 * and context formatting by delegating to focused services.
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
  private readonly commitEnricher?: ICommitEnricher;

  // Extracted services
  private readonly formatter: SessionContextFormatter;
  private readonly gitService: GitIntrospectionService;
  private readonly memoryLoader: MemoryContextLoader;
  private readonly triageService: IGitTriageService;

  /**
   * Create a new SessionStartHandler.
   *
   * @param services - Lisa services (legacy constructor for backward compatibility)
   * @param gitClient - Git client (optional, creates default if not provided)
   */
  constructor(services: ILisaServices, gitClient?: IGitClient);

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
   * @param gitClient - Git client (optional)
   */
  constructor(
    context: ILisaContext,
    memory: IMemoryService,
    tasks: ITaskService,
    mcp: IMcpClient,
    router?: IRepositoryRouter,
    logger?: ILogger,
    githubSync?: IGitHubSyncService,
    gitClient?: IGitClient,
  );

  constructor(
    contextOrServices: ILisaContext | ILisaServices,
    memoryOrGitClient?: IMemoryService | IGitClient,
    tasks?: ITaskService,
    mcp?: IMcpClient,
    router?: IRepositoryRouter,
    logger?: ILogger,
    githubSync?: IGitHubSyncService,
    gitClient?: IGitClient,
  ) {
    let resolvedGitClient: IGitClient | undefined;

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
      this.commitEnricher = services.commitEnricher;
      resolvedGitClient = memoryOrGitClient as IGitClient | undefined;
    } else {
      // Individual service injection
      this.context = contextOrServices as ILisaContext;
      this.memory = memoryOrGitClient as IMemoryService;
      this.tasks = tasks!;
      this.mcp = mcp!;
      this.router = router;
      this.logger = logger;
      this.githubSync = githubSync;
      resolvedGitClient = gitClient;
    }

    // Lazy-load default GitClient if none provided
    if (!resolvedGitClient) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GitClient } = require('../../infrastructure/git/GitClient');
      resolvedGitClient = new GitClient() as IGitClient;
    }

    // Initialize extracted services
    this.formatter = new SessionContextFormatter();
    this.gitService = new GitIntrospectionService(resolvedGitClient);
    this.memoryLoader = new MemoryContextLoader(
      this.memory,
      this.tasks,
      this.mcp,
      this.router,
      this.logger,
    );
    this.triageService = new GitTriageService(resolvedGitClient);
  }

  /**
   * Handle a session start request.
   */
  async handle(request: SessionStartRequest): Promise<ISessionStartResult> {
    const { hierarchicalGroupIds, projectAliases, branch, projectName, userName, folderType, projectRoot } = this.context;

    // Sync GitHub issues on startup (non-blocking, fire-and-forget for speed)
    await this.syncGitHubOnStartup(request.trigger, hierarchicalGroupIds, projectName);

    // Determine date options based on trigger
    const dateOptions = this.computeDateOptions(request.trigger);

    // Load memory and run git triage in parallel
    const [memories, gitTriage] = await Promise.all([
      this.memoryLoader.loadMemory(
        hierarchicalGroupIds,
        projectAliases,
        branch,
        dateOptions,
      ),
      this.runGitTriage(dateOptions.since, projectRoot),
    ]);

    // Load recent git commits as fallback (only if triage didn't run)
    const gitCommits = gitTriage
      ? []
      : await this.gitService.loadGitCommits(dateOptions.since, projectRoot);

    // Enrich high-interest commits (fire-and-forget, non-blocking)
    if (gitTriage && request.trigger === 'startup') {
      this.enrichAndSaveCommits(gitTriage.highInterest, hierarchicalGroupIds[0])
        .catch(err => this.logger?.warn('Commit enrichment failed', { error: (err as Error).message }));
    }

    // Process tasks from memory
    const tasks = this.processTasks(memories.tasks);
    const taskCounts = this.countTasks(tasks);

    // Build context content
    const contextContent = this.formatter.formatContextContent(
      request.trigger,
      memories,
      tasks,
      taskCounts,
      { projectName, userName, folderType, projectRoot, branch },
      gitCommits,
      dateOptions.since,
      gitTriage,
    );

    // Build message
    const message = this.formatter.getTriggerMessage(request.trigger, memories.timedOut);

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
   * Sync GitHub issues on startup (fire-and-forget).
   */
  private async syncGitHubOnStartup(
    trigger: SessionTrigger,
    hierarchicalGroupIds: readonly string[],
    projectName: string,
  ): Promise<void> {
    if (!this.githubSync || trigger !== 'startup') return;

    try {
      const repo = await this.gitService.detectGitHubRepo(this.context.projectRoot);
      if (!repo) return;

      const groupId = hierarchicalGroupIds[0] || projectName;
      this.logger?.debug('Starting GitHub sync', { repo, groupId });

      const result = await this.githubSync.sync({
        repo,
        direction: 'import',
        groupId,
        dryRun: false,
      });

      this.logger?.info('GitHub sync completed', {
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
      });
    } catch (error) {
      // Don't fail session start if GitHub sync fails
      this.logger?.warn('GitHub sync failed', { error: (error as Error).message });
    }
  }

  /**
   * Run git triage to analyze commit history.
   * Returns null if triage fails (non-blocking).
   */
  private async runGitTriage(since: Date | undefined, projectRoot: string): Promise<ITriageResult | null> {
    try {
      const result = await this.triageService.triage({
        since,
        cwd: projectRoot,
      });
      this.logger?.debug('Git triage completed', {
        total: result.totalCommits,
        highInterest: result.highInterest.length,
        durationMs: result.durationMs,
      });
      return result;
    } catch (error) {
      // Don't fail session start if triage fails
      this.logger?.warn('Git triage failed', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Enrich high-interest commits and save facts to memory (fire-and-forget).
   */
  private async enrichAndSaveCommits(
    commits: readonly IScoredCommit[],
    groupId: string,
  ): Promise<void> {
    if (!this.commitEnricher || commits.length === 0) return;

    try {
      // Check which commits are already enriched (by SHA tag)
      const existingShas = await this.checkEnrichedCommits(groupId, commits);
      const toEnrich = commits.filter(c => !existingShas.has(c.commit.sha));

      if (toEnrich.length === 0) {
        this.logger?.debug('All commits already enriched, skipping');
        return;
      }

      this.logger?.debug('Enriching commits', { count: toEnrich.length });

      const result = await this.commitEnricher.enrich(toEnrich, { maxCommits: 5 });

      if (result.facts.length === 0) {
        this.logger?.debug('No facts extracted from commits');
        return;
      }

      // Save facts to memory with proper metadata
      for (const fact of result.facts) {
        const tags = [
          'type:commit-enrichment',
          `commit:${fact.commitSha}`,
          `factType:${fact.type}`,
          `confidence:${fact.confidence}`,
          'source:git-enrichment',
          ...fact.tags.map(t => `tag:${t}`),
        ];

        await this.memory.addFact(groupId, fact.text, tags);
      }

      this.logger?.info('Commit enrichment complete', {
        processed: result.commitsProcessed,
        facts: result.facts.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    } catch (error) {
      // Non-blocking - log and continue
      this.logger?.warn('Commit enrichment error', { error: (error as Error).message });
    }
  }

  /**
   * Check which commits have already been enriched (by SHA tag in memory).
   */
  private async checkEnrichedCommits(
    groupId: string,
    _commits: readonly IScoredCommit[],
  ): Promise<Set<string>> {
    const enrichedShas = new Set<string>();

    try {
      // Search for existing commit enrichment facts
      const existingFacts = await this.memory.searchFacts(
        [groupId],
        'type:commit-enrichment',
        100,
      );

      for (const fact of existingFacts) {
        const shaTag = fact.tags?.find(t => t.startsWith('commit:'));
        if (shaTag) {
          enrichedShas.add(shaTag.replace('commit:', ''));
        }
      }
    } catch (error) {
      // If search fails, return empty set (will re-enrich)
      this.logger?.debug('Could not check existing enrichments', { error: (error as Error).message });
    }

    return enrichedShas;
  }

  /**
   * Compute date options based on trigger type.
   */
  private computeDateOptions(trigger: SessionTrigger): IMemoryDateOptions {
    const dateOptions: IMemoryDateOptions = {};
    const now = new Date();
    if (trigger === 'startup') {
      // Start of today (midnight local time)
      dateOptions.since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      // Last 24 hours for resume/compact/clear
      dateOptions.since = new Date(now.getTime() - RECENT_HOURS * 60 * 60 * 1000);
    }
    return dateOptions;
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

  // --- Task helper methods ---

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
}
