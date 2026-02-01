/**
 * Project Context Types
 *
 * Structured project context - a curated snapshot of the project's
 * tech stack, key decisions, active constraints, and team conventions.
 * Loaded at session start for always-available context.
 */

/**
 * Structured project context.
 */
export interface IProjectContext {
  readonly projectName: string;
  readonly techStack: readonly string[];
  readonly keyDecisions: readonly string[];
  readonly activeConstraints: readonly string[];
  readonly conventions: readonly string[];
  readonly updatedAt: string;
}

/**
 * Updates to apply to a project context.
 */
export type IProjectContextUpdates = Partial<Omit<IProjectContext, 'projectName' | 'updatedAt'>>;

/**
 * Service interface for managing project context.
 */
export interface IProjectContextService {
  /**
   * Load project context from file.
   * Returns null if no context file exists.
   */
  load(projectRoot: string): Promise<IProjectContext | null>;

  /**
   * Save project context to file.
   */
  save(projectRoot: string, context: IProjectContext): Promise<void>;

  /**
   * Initialize a new project context with auto-detection.
   * Detects tech stack from project files (package.json, Dockerfile, etc.).
   */
  init(projectRoot: string, projectName: string): Promise<IProjectContext>;

  /**
   * Update existing project context with partial updates.
   * Merges arrays (appends new items) and updates timestamp.
   */
  update(projectRoot: string, updates: IProjectContextUpdates): Promise<IProjectContext>;
}
