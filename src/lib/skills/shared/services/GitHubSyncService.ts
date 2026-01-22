/**
 * GitHub Sync Service - Bidirectional sync between Lisa tasks and GitHub Issues.
 *
 * Supports:
 * - Import: Pull GitHub issues -> create Lisa tasks with externalLink
 * - Export: Push unlinked Lisa tasks -> create GitHub issues, add link
 * - Bidirectional: Full two-way sync with conflict detection
 *
 * Status mapping:
 * - ready         <-> open (no status labels)
 * - in-progress   <-> open + in-progress label
 * - blocked       <-> open + blocked label
 * - done          <-> closed
 */
import type { IGitHubClient, IGitHubIssue } from './GitHubService';
import type {
  ITaskService,
  ITask,
  ITaskExternalLink,
} from './interfaces';

// ============================================================================
// Types
// ============================================================================

/**
 * Task status values supported by Lisa.
 */
export type LisaTaskStatus = 'ready' | 'todo' | 'in-progress' | 'blocked' | 'done';

/**
 * Sync direction options.
 */
export type SyncDirection = 'import' | 'export' | 'bidirectional';

/**
 * Options for sync operations.
 */
export interface ISyncOptions {
  /** Repository in owner/repo format */
  repo: string;
  /** Preview changes without applying */
  dryRun?: boolean;
  /** Filter GitHub issues by labels */
  labels?: string[];
  /** Sync direction */
  direction: SyncDirection;
  /** Group ID for Lisa tasks */
  groupId: string;
  /** Default repo for tasks */
  defaultRepo?: string;
  /** Default assignee for tasks */
  defaultAssignee?: string;
}

/**
 * Conflict information when both sides have changes.
 */
export interface ISyncConflict {
  taskUuid: string;
  taskTitle: string;
  issueNumber: number;
  reason: string;
  resolution: 'local' | 'remote';
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

/**
 * Detailed item info for sync results.
 */
export interface ISyncItem {
  title: string;
  taskUuid?: string;
  issueNumber?: number;
  issueUrl?: string;
}

/**
 * Result of a sync operation.
 */
export interface ISyncResult {
  /** Number of items imported (GitHub -> Lisa) */
  imported: number;
  /** Items that were imported */
  importedItems: ISyncItem[];
  /** Number of items exported (Lisa -> GitHub) */
  exported: number;
  /** Items that were exported */
  exportedItems: ISyncItem[];
  /** Number of items with status synced */
  updated: number;
  /** Items that were updated */
  updatedItems: ISyncItem[];
  /** Number of items already in sync */
  skipped: number;
  /** Conflicts detected (with resolutions applied) */
  conflicts: ISyncConflict[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * GitHub sync service interface.
 */
export interface IGitHubSyncService {
  /**
   * Sync tasks between Lisa and GitHub.
   */
  sync(options: ISyncOptions): Promise<ISyncResult>;

  /**
   * Preview sync changes without applying (same as sync with dryRun=true).
   */
  previewSync(options: ISyncOptions): Promise<ISyncResult>;
}

// ============================================================================
// Status Mapping
// ============================================================================

/**
 * Map Lisa task status to GitHub issue state and labels.
 */
export function lisaStatusToGitHub(status: string): {
  state: 'open' | 'closed';
  addLabels: string[];
  removeLabels: string[];
} {
  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
    case 'done':
    case 'closed':
    case 'completed':
      return { state: 'closed', addLabels: [], removeLabels: ['in-progress', 'blocked'] };
    case 'in-progress':
    case 'in_progress':
    case 'active':
      return { state: 'open', addLabels: ['in-progress'], removeLabels: ['blocked'] };
    case 'blocked':
      return { state: 'open', addLabels: ['blocked'], removeLabels: ['in-progress'] };
    case 'ready':
    case 'todo':
    case 'pending':
    default:
      return { state: 'open', addLabels: [], removeLabels: ['in-progress', 'blocked'] };
  }
}

/**
 * Map GitHub issue state and labels to Lisa task status.
 */
export function gitHubStatusToLisa(issue: IGitHubIssue): LisaTaskStatus {
  if (issue.state === 'closed') {
    return 'done';
  }
  const labels = issue.labels.map((l) => l.toLowerCase());
  if (labels.includes('blocked')) {
    return 'blocked';
  }
  if (labels.includes('in-progress') || labels.includes('in_progress')) {
    return 'in-progress';
  }
  return 'ready';
}

/**
 * Build a URL for a GitHub issue.
 * Reserved for future use when creating links manually.
 */
function _buildIssueUrl(repo: string, issueNumber: number): string {
  return `https://github.com/${repo}/issues/${issueNumber}`;
}

/**
 * Parse ISO date string to Date, handling edge cases.
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Dependencies for creating a GitHub sync service.
 */
export interface IGitHubSyncServiceDependencies {
  github: IGitHubClient;
  tasks: ITaskService;
}

/**
 * Creates a GitHub sync service instance.
 */
export function createGitHubSyncService(
  deps: IGitHubSyncServiceDependencies
): IGitHubSyncService {
  const { github, tasks } = deps;

  /**
   * Find a Lisa task linked to a specific GitHub issue.
   * Reserved for future use in more granular sync operations.
   */
  async function _findLinkedTask(
    options: ISyncOptions,
    issueNumber: number
  ): Promise<ITask | undefined> {
    const result = await tasks.listLinked(
      [options.groupId],
      'github',
      1000,
      options.defaultRepo || '',
      options.defaultAssignee || ''
    );
    return result.tasks.find(
      (t) =>
        t.externalLink?.source === 'github' &&
        t.externalLink?.id === String(issueNumber)
    );
  }

  /**
   * Import a single GitHub issue as a Lisa task.
   */
  async function importIssue(
    options: ISyncOptions,
    issue: IGitHubIssue
  ): Promise<ISyncItem> {
    const status = gitHubStatusToLisa(issue);
    const externalLink: ITaskExternalLink = {
      source: 'github',
      id: String(issue.number),
      url: issue.url,
      syncedAt: new Date().toISOString(),
    };

    await tasks.add(issue.title, options.groupId, {
      status,
      repo: options.repo,
      assignee: issue.assignees[0] || options.defaultAssignee || '',
      notes: issue.body || undefined,
      externalLink,
    });

    return {
      title: issue.title,
      issueNumber: issue.number,
      issueUrl: issue.url,
    };
  }

  /**
   * Export a Lisa task to a new GitHub issue.
   */
  async function exportTask(
    options: ISyncOptions,
    task: ITask
  ): Promise<ISyncItem> {
    // Create GitHub issue
    const statusMapping = lisaStatusToGitHub(task.status);
    const labels = [...(statusMapping.addLabels || [])];

    const result = await github.createIssue({
      repo: options.repo,
      title: task.title,
      body: task.notes || undefined,
      labels: labels.length > 0 ? labels : undefined,
      assignee: task.assignee || undefined,
    });

    // If task should be closed, close the issue
    if (statusMapping.state === 'closed') {
      await github.closeIssue({
        repo: options.repo,
        number: result.number,
      });
    }

    // Link the task to the GitHub issue
    const externalLink: ITaskExternalLink = {
      source: 'github',
      id: String(result.number),
      url: result.url,
      syncedAt: new Date().toISOString(),
    };

    await tasks.link(task.uuid, options.groupId, externalLink);

    return {
      title: task.title,
      taskUuid: task.uuid,
      issueNumber: result.number,
      issueUrl: result.url,
    };
  }

  /**
   * Update a linked task's status based on GitHub issue state.
   */
  async function updateFromGitHub(
    options: ISyncOptions,
    task: ITask,
    issue: IGitHubIssue
  ): Promise<ISyncItem> {
    const newStatus = gitHubStatusToLisa(issue);

    await tasks.update(task.title, options.groupId, {
      status: newStatus,
      repo: task.repo,
      assignee: issue.assignees[0] || task.assignee,
      notes: issue.body || task.notes,
      externalLink: {
        ...task.externalLink!,
        syncedAt: new Date().toISOString(),
      },
    });

    return {
      title: task.title,
      taskUuid: task.uuid,
      issueNumber: issue.number,
      issueUrl: issue.url,
    };
  }

  /**
   * Update a GitHub issue's state/labels based on Lisa task status.
   */
  async function updateToGitHub(
    options: ISyncOptions,
    task: ITask,
    issue: IGitHubIssue
  ): Promise<ISyncItem> {
    const statusMapping = lisaStatusToGitHub(task.status);

    // Update labels if needed
    if (statusMapping.addLabels.length > 0 || statusMapping.removeLabels.length > 0) {
      // Filter removeLabels to only those that exist
      const labelsToRemove = statusMapping.removeLabels.filter((l) =>
        issue.labels.some((il) => il.toLowerCase() === l.toLowerCase())
      );
      // Filter addLabels to only those that don't exist
      const labelsToAdd = statusMapping.addLabels.filter(
        (l) => !issue.labels.some((il) => il.toLowerCase() === l.toLowerCase())
      );

      if (labelsToAdd.length > 0 || labelsToRemove.length > 0) {
        await github.labelIssue({
          repo: options.repo,
          number: issue.number,
          add: labelsToAdd.length > 0 ? labelsToAdd : undefined,
          remove: labelsToRemove.length > 0 ? labelsToRemove : undefined,
        });
      }
    }

    // Update state if needed
    if (statusMapping.state === 'closed' && issue.state === 'open') {
      await github.closeIssue({ repo: options.repo, number: issue.number });
    } else if (statusMapping.state === 'open' && issue.state === 'closed') {
      await github.reopenIssue({ repo: options.repo, number: issue.number });
    }

    // Update sync timestamp on the task
    await tasks.update(task.title, options.groupId, {
      status: task.status,
      repo: task.repo,
      assignee: task.assignee,
      notes: task.notes,
      externalLink: {
        ...task.externalLink!,
        syncedAt: new Date().toISOString(),
      },
    });

    return {
      title: task.title,
      taskUuid: task.uuid,
      issueNumber: issue.number,
      issueUrl: issue.url,
    };
  }

  /**
   * Determine conflict resolution using last-write-wins strategy.
   */
  function resolveConflict(
    task: ITask,
    issue: IGitHubIssue
  ): 'local' | 'remote' {
    const taskUpdatedAt = parseDate(task.created_at); // Tasks don't have updatedAt, use created_at
    const issueUpdatedAt = parseDate(issue.updatedAt);

    if (!taskUpdatedAt && issueUpdatedAt) return 'remote';
    if (taskUpdatedAt && !issueUpdatedAt) return 'local';
    if (!taskUpdatedAt && !issueUpdatedAt) return 'remote'; // Default to remote

    return issueUpdatedAt!.getTime() > taskUpdatedAt!.getTime() ? 'remote' : 'local';
  }

  /**
   * Check if a task's status matches a GitHub issue's state.
   */
  function statusesMatch(task: ITask, issue: IGitHubIssue): boolean {
    const expectedStatus = gitHubStatusToLisa(issue);
    const normalizedTaskStatus = task.status.toLowerCase().replace('_', '-');
    return normalizedTaskStatus === expectedStatus;
  }

  return {
    async sync(options: ISyncOptions): Promise<ISyncResult> {
      const result: ISyncResult = {
        imported: 0,
        importedItems: [],
        exported: 0,
        exportedItems: [],
        updated: 0,
        updatedItems: [],
        skipped: 0,
        conflicts: [],
        dryRun: options.dryRun ?? false,
      };

      // Get all GitHub issues
      const issuesResult = await github.listIssues({
        repo: options.repo,
        state: 'all',
        labels: options.labels,
        limit: 100,
      });
      const issues = issuesResult.issues;

      // Get all Lisa tasks
      const tasksResult = await tasks.list(
        [options.groupId],
        1000,
        options.defaultRepo || '',
        options.defaultAssignee || ''
      );
      const allTasks = tasksResult.tasks;

      // Build lookup maps
      const issueByNumber = new Map<number, IGitHubIssue>();
      for (const issue of issues) {
        issueByNumber.set(issue.number, issue);
      }

      const linkedTaskByIssueNumber = new Map<number, ITask>();
      const unlinkedTasks: ITask[] = [];
      for (const task of allTasks) {
        if (task.externalLink?.source === 'github') {
          const issueNum = parseInt(task.externalLink.id, 10);
          linkedTaskByIssueNumber.set(issueNum, task);
        } else if (!task.externalLink) {
          unlinkedTasks.push(task);
        }
      }

      // Process based on direction
      if (options.direction === 'import' || options.direction === 'bidirectional') {
        // Import: Process GitHub issues
        for (const issue of issues) {
          const linkedTask = linkedTaskByIssueNumber.get(issue.number);

          if (!linkedTask) {
            // New issue - import it
            if (!options.dryRun) {
              const item = await importIssue(options, issue);
              result.importedItems.push(item);
            } else {
              result.importedItems.push({
                title: issue.title,
                issueNumber: issue.number,
                issueUrl: issue.url,
              });
            }
            result.imported++;
          } else if (!statusesMatch(linkedTask, issue)) {
            // Status mismatch - check if we need to update

            if (options.direction === 'bidirectional') {
              // Conflict: both sides exist with different status
              const resolution = resolveConflict(linkedTask, issue);
              result.conflicts.push({
                taskUuid: linkedTask.uuid,
                taskTitle: linkedTask.title,
                issueNumber: issue.number,
                reason: `Status mismatch: Lisa="${linkedTask.status}", GitHub="${issue.state}"`,
                resolution,
                localUpdatedAt: linkedTask.created_at,
                remoteUpdatedAt: issue.updatedAt,
              });

              if (!options.dryRun) {
                if (resolution === 'remote') {
                  const item = await updateFromGitHub(options, linkedTask, issue);
                  result.updatedItems.push(item);
                } else {
                  const item = await updateToGitHub(options, linkedTask, issue);
                  result.updatedItems.push(item);
                }
              } else {
                result.updatedItems.push({
                  title: linkedTask.title,
                  taskUuid: linkedTask.uuid,
                  issueNumber: issue.number,
                  issueUrl: issue.url,
                });
              }
              result.updated++;
            } else {
              // Import-only: always take GitHub's status
              if (!options.dryRun) {
                const item = await updateFromGitHub(options, linkedTask, issue);
                result.updatedItems.push(item);
              } else {
                result.updatedItems.push({
                  title: linkedTask.title,
                  taskUuid: linkedTask.uuid,
                  issueNumber: issue.number,
                  issueUrl: issue.url,
                });
              }
              result.updated++;
            }
          } else {
            // Already in sync
            result.skipped++;
          }
        }
      }

      if (options.direction === 'export' || options.direction === 'bidirectional') {
        // Export: Process unlinked Lisa tasks
        for (const task of unlinkedTasks) {
          if (!options.dryRun) {
            const item = await exportTask(options, task);
            result.exportedItems.push(item);
          } else {
            result.exportedItems.push({
              title: task.title,
              taskUuid: task.uuid,
            });
          }
          result.exported++;
        }

        // For bidirectional, also update GitHub from linked tasks with mismatched status
        if (options.direction === 'bidirectional') {
          for (const task of allTasks) {
            if (task.externalLink?.source === 'github') {
              const issueNum = parseInt(task.externalLink.id, 10);
              const issue = issueByNumber.get(issueNum);

              // Skip if we already processed this in the import phase
              // or if the issue doesn't exist anymore
              if (!issue) continue;

              // Check if we already updated this pair
              const alreadyUpdated = result.updatedItems.some(
                (item) => item.taskUuid === task.uuid
              );
              if (alreadyUpdated) continue;

              if (!statusesMatch(task, issue)) {
                const resolution = resolveConflict(task, issue);

                // Only process if we should push to GitHub (local wins)
                if (resolution === 'local') {
                  result.conflicts.push({
                    taskUuid: task.uuid,
                    taskTitle: task.title,
                    issueNumber: issue.number,
                    reason: `Status mismatch: Lisa="${task.status}", GitHub="${issue.state}"`,
                    resolution,
                    localUpdatedAt: task.created_at,
                    remoteUpdatedAt: issue.updatedAt,
                  });

                  if (!options.dryRun) {
                    const item = await updateToGitHub(options, task, issue);
                    result.updatedItems.push(item);
                  } else {
                    result.updatedItems.push({
                      title: task.title,
                      taskUuid: task.uuid,
                      issueNumber: issue.number,
                      issueUrl: issue.url,
                    });
                  }
                  result.updated++;
                }
              }
            }
          }
        }
      }

      return result;
    },

    async previewSync(options: ISyncOptions): Promise<ISyncResult> {
      return this.sync({ ...options, dryRun: true });
    },
  };
}
