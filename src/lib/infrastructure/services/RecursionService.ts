import type {
  IRecursionService,
  IRecursionResult,
  IRecursionConfig,
  IMemoryService,
  ITaskService,
  IMemoryItem,
  ITask,
  TaskType,
} from '../../domain';
import { getDefaultStrategy } from '../../domain/interfaces/types/ITaskType';

/**
 * Default configuration for recursion.
 */
const DEFAULT_CONFIG: IRecursionConfig = {
  minPromptLength: 20,
  maxResultsPerType: 3,
  queryTimeoutMs: 3000,
};

/**
 * Common stop words to filter from topic extraction.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
  'now', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'any', 'some', 'no', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'its', 'it', 'i', 'me', 'my', 'myself',
  'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself',
  'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'they', 'them', 'their', 'theirs', 'themselves',
  'want', 'like', 'add', 'create', 'make', 'build', 'implement', 'write',
  'update', 'change', 'modify', 'remove', 'delete', 'fix', 'help', 'please',
  'using', 'use',
]);

/**
 * Technical patterns that should be prioritized in topic extraction.
 */
const TECH_PATTERNS = /^(api|db|cache|auth|config|service|handler|controller|model|schema|test|hook|event|memory|task|session)$/i;

/**
 * Empty result constant.
 */
const EMPTY_RESULT: IRecursionResult = {
  hasContext: false,
  decisions: [],
  learnings: [],
  relatedTasks: [],
  summary: '',
};

/**
 * Service for searching memory based on task context.
 *
 * When a user submits a prompt, this service searches memory for
 * relevant context: previous decisions, learnings, and tasks.
 * The search strategy adapts based on the detected task type.
 */
export class RecursionService implements IRecursionService {
  private readonly config: IRecursionConfig;

  constructor(
    private readonly memory: IMemoryService,
    private readonly tasks: ITaskService,
    config?: Partial<IRecursionConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if recursion should run for a given prompt.
   * Triggers for plan mode, and also for debugging/exploration task types.
   */
  shouldRun(prompt: string, permissionMode: string, taskType?: TaskType): boolean {
    // Skip short prompts
    if (prompt.length < this.config.minPromptLength) {
      return false;
    }

    // Skip commands
    if (prompt.trim().startsWith('/')) {
      return false;
    }

    // Plan mode always triggers
    if (permissionMode === 'plan') {
      return true;
    }

    // Debugging and exploration benefit from memory search
    if (taskType === 'debugging' || taskType === 'exploration') {
      return true;
    }

    return false;
  }

  /**
   * Run memory recursion for a prompt.
   * Uses mode-specific search types when taskType is provided.
   */
  async run(prompt: string, groupIds: readonly string[], taskType?: TaskType): Promise<IRecursionResult> {
    // Determine search strategy based on task type (computed once)
    const strategy = taskType ? getDefaultStrategy(taskType) : undefined;

    // Extract topics from prompt
    const topics = this.extractTopics(prompt, strategy?.searchBreadth);
    if (topics.length === 0) {
      return EMPTY_RESULT;
    }

    // Build search query from topics
    const query = topics.join(' ');
    const timeout = strategy?.timeout ?? this.config.queryTimeoutMs;
    const maxResults = strategy?.maxResults ?? this.config.maxResultsPerType;
    const searchTypes = strategy?.searchTypes ?? ['decision', 'retrospective'];

    // Build parallel searches based on strategy
    const memorySearches = searchTypes
      .filter((t) => t !== 'task' && t !== 'recent')
      .map((type) => this.searchByType(groupIds, query, type, maxResults));
    const includesTasks = searchTypes.includes('task');

    // Run searches in parallel with timeout
    const emptyMemoryResults: IMemoryItem[][] = memorySearches.map(() => []);
    const timeoutPromise = new Promise<[IMemoryItem[][], ITask[]]>((resolve) => {
      setTimeout(() => resolve([emptyMemoryResults, []]), timeout);
    });

    const searchPromise = Promise.all([
      Promise.all(memorySearches),
      includesTasks ? this.searchTasks(groupIds, query, maxResults) : Promise.resolve([]),
    ]);

    let memoryResults: IMemoryItem[][] = emptyMemoryResults;
    let taskResults: ITask[] = [];

    try {
      [memoryResults, taskResults] = await Promise.race([searchPromise, timeoutPromise]);
    } catch {
      return EMPTY_RESULT;
    }

    // Separate decisions and learnings from other search results
    const decisionTypes = new Set(['decision']);
    const learningTypes = new Set(['retrospective']);
    const decisions: IMemoryItem[] = [];
    const learnings: IMemoryItem[] = [];

    const nonTaskTypes = searchTypes.filter((t) => t !== 'task' && t !== 'recent');
    for (let i = 0; i < nonTaskTypes.length; i++) {
      const type = nonTaskTypes[i];
      const results = memoryResults[i] ?? [];
      if (decisionTypes.has(type)) {
        decisions.push(...results);
      } else if (learningTypes.has(type)) {
        learnings.push(...results);
      } else {
        // Other types (pattern, bug, error, gotcha) go to learnings
        learnings.push(...results);
      }
    }

    // Format results
    const formattedDecisions = decisions.map((d) => this.formatFact(d));
    const formattedLearnings = learnings.map((l) => this.formatFact(l));
    const formattedTasks = taskResults.map((t) => this.formatTask(t));

    // Check if we found anything
    const hasContext = formattedDecisions.length > 0 || formattedLearnings.length > 0 || formattedTasks.length > 0;

    if (!hasContext) {
      return EMPTY_RESULT;
    }

    return {
      hasContext: true,
      decisions: formattedDecisions,
      learnings: formattedLearnings,
      relatedTasks: formattedTasks,
      summary: this.buildSummary(formattedDecisions, formattedLearnings, formattedTasks),
    };
  }

  /**
   * Extract meaningful topics from a prompt.
   */
  private extractTopics(prompt: string, searchBreadth?: number): string[] {
    const breadth = searchBreadth ?? 5;

    // Normalize and split
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    // Dedupe
    const unique = [...new Set(words)];

    // Prioritize technical terms and longer words
    unique.sort((a, b) => {
      const aIsTech = TECH_PATTERNS.test(a);
      const bIsTech = TECH_PATTERNS.test(b);
      if (aIsTech && !bIsTech) return -1;
      if (bIsTech && !aIsTech) return 1;
      return b.length - a.length;
    });

    return unique.slice(0, breadth);
  }

  /**
   * Search memory for facts of a specific type.
   */
  private async searchByType(
    groupIds: readonly string[],
    query: string,
    type: string,
    maxResults?: number
  ): Promise<IMemoryItem[]> {
    const limit = maxResults ?? this.config.maxResultsPerType;
    try {
      // Search with the query - the memory service will filter by tags if supported
      const results = await this.memory.searchFacts(
        groupIds,
        `${type} ${query}`,
        limit * 2
      );

      // Filter to items with matching type tag and limit results
      const filtered = results
        .filter((r) => r.tags?.some((t) => t === `type:${type}`))
        .slice(0, limit);

      return filtered;
    } catch {
      return [];
    }
  }

  /**
   * Search for related tasks.
   */
  private async searchTasks(
    groupIds: readonly string[],
    query: string,
    maxResults?: number
  ): Promise<ITask[]> {
    const limit = maxResults ?? this.config.maxResultsPerType;
    try {
      // Use task service to get tasks
      const allTasks = await this.tasks.getTasksSimple(groupIds);

      // Filter tasks by query relevance (simple keyword matching)
      const queryWords = query.toLowerCase().split(/\s+/);
      const relevant = allTasks
        .filter((task: ITask) => {
          const title = task.title.toLowerCase();
          return queryWords.some((word) => title.includes(word));
        })
        .slice(0, limit);

      return relevant as ITask[];
    } catch {
      return [];
    }
  }

  /**
   * Format a memory fact for display.
   */
  private formatFact(item: IMemoryItem): string {
    const text = item.fact || item.name || '<unknown>';
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  }

  /**
   * Format a task for display.
   */
  private formatTask(task: ITask): string {
    const prefix = task.key ? `#${task.key}` : '';
    const suffix = task.status && task.status !== 'unknown' ? ` (${task.status})` : '';

    const text = `${prefix} ${task.title}${suffix}`.trim();
    return text.length > 100 ? text.slice(0, 97) + '...' : text;
  }

  /**
   * Build formatted summary output.
   */
  private buildSummary(
    decisions: readonly string[],
    learnings: readonly string[],
    tasks: readonly string[]
  ): string {
    const sections: string[] = [];

    if (decisions.length > 0) {
      sections.push('📌 Previous Decisions:');
      decisions.forEach((d) => sections.push(`  - ${d}`));
    }

    if (learnings.length > 0) {
      sections.push('📝 Learnings:');
      learnings.forEach((l) => sections.push(`  - ${l}`));
    }

    if (tasks.length > 0) {
      sections.push('📋 Related Tasks:');
      tasks.forEach((t) => sections.push(`  - ${t}`));
    }

    return sections.join('\n');
  }
}
