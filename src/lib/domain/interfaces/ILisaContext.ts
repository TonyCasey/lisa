/**
 * Project context information.
 * Detected from the current working directory.
 */
export interface ILisaContext {
  /** Absolute path to project root */
  readonly projectRoot: string;
  
  /** Git worktree path (if in a worktree) */
  readonly gitWorktree?: string;
  
  /** Group ID for memory operations */
  readonly groupId: string;
  
  /** Hierarchical group IDs (current + parent folders) */
  readonly hierarchicalGroupIds: readonly string[];
  
  /** Project name (folder name or repo name) */
  readonly projectName: string;
  
  /** All project aliases (folder name, repo name, etc.) */
  readonly projectAliases: readonly string[];
  
  /** Current git branch (if in a git repo) */
  readonly branch: string | null;
  
  /** Current user name */
  readonly userName: string;
  
  /** Folder type metadata (e.g., "TypeScript/React project") */
  readonly folderType: string;
}
