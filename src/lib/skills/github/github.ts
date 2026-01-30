#!/usr/bin/env node
/**
 * GitHub CLI - thin entry point.
 *
 * Commands:
 *   Issues:
 *     node github.js issues list --repo owner/repo [--state open|closed|all] [--labels x,y] [--assignee user] [--limit N]
 *     node github.js issues create --repo owner/repo --title "..." [--body "..."] [--labels x,y] [--assignee user]
 *     node github.js issues view --repo owner/repo <number>
 *     node github.js issues close --repo owner/repo <number> [--reason completed|not_planned]
 *     node github.js issues reopen --repo owner/repo <number>
 *     node github.js issues assign --repo owner/repo <number> --to user1,user2
 *     node github.js issues label --repo owner/repo <number> [--add x,y] [--remove z]
 *
 *   Projects:
 *     node github.js projects list --repo owner/repo [--limit N]
 *     node github.js projects view --repo owner/repo <number>
 *     node github.js projects items --repo owner/repo <number> [--limit N]
 *     node github.js projects fields --repo owner/repo <number>
 *     node github.js projects add --repo owner/repo <project-number> <issue-number>
 *     node github.js projects set-field --repo owner/repo <project-number> <item-id> --field <name> --value <value>
 *
 *   Sync:
 *     node github.js sync --repo owner/repo [--import|--export] [--labels x,y] [--dry-run] [--group group-id]
 */

export {};

import type {
  ITaskService,
  ITaskExternalLink,
  ITaskWriteOptions,
} from '../shared/services/interfaces';

interface IParsedArgs {
  subcommand: string | null;  // 'issues' or 'projects'
  command: string | null;     // 'list', 'create', 'view', etc.
  args: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): IParsedArgs {
  const args: Record<string, string | boolean> = {};
  let subcommand: string | null = null;
  let command: string | null = null;
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else if (!subcommand) {
      subcommand = arg;
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { subcommand, command, args, positional };
}

function formatError(error: string, usage?: string): string {
  return JSON.stringify({
    status: 'error',
    error,
    ...(usage ? { usage } : {}),
  }, null, 2);
}

function formatSuccess(action: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    status: 'ok',
    action,
    ...data,
  }, null, 2);
}

export interface ICreatedIssueSummary {
  number: number;
  url: string;
  title: string;
  body?: string;
  assignee?: string;
}

export async function persistCreatedIssueTask(options: {
  tasks: ITaskService;
  groupId: string;
  repo: string;
  issue: ICreatedIssueSummary;
}): Promise<void> {
  const { tasks, groupId, repo, issue } = options;
  const externalLink: ITaskExternalLink = {
    source: 'github',
    id: String(issue.number),
    url: issue.url,
    syncedAt: new Date().toISOString(),
  };

  const taskOptions: ITaskWriteOptions = {
    status: 'todo',
    repo,
    assignee: issue.assignee || '',
    notes: issue.body || undefined,
    externalLink,
  };

  const linked = await tasks.listLinked([groupId], 'github', 1000, repo, issue.assignee || '');
  const existing = linked.tasks.find(
    (task) => task.externalLink?.source === 'github' && task.externalLink?.id === String(issue.number)
  );

  if (existing) {
    await tasks.update(issue.title, groupId, taskOptions);
    return;
  }

  await tasks.add(issue.title, groupId, taskOptions);
}

async function handleIssues(
  command: string | null,
  args: Record<string, string | boolean>,
  positional: string[]
): Promise<void> {
  const { createGitHubClient } = await import('../shared/services');
  const { createGhCliClientFromEnv } = await import('../shared/clients');

  const ghCli = createGhCliClientFromEnv();
  const client = createGitHubClient(ghCli);

  const repo = args.repo as string;
  if (!repo && command !== 'help') {
    console.log(formatError('--repo owner/repo is required', 'github issues <command> --repo owner/repo'));
    process.exit(1);
  }

  switch (command) {
    case 'list': {
      const result = await client.listIssues({
        repo,
        state: args.state as 'open' | 'closed' | 'all' | undefined,
        labels: args.labels ? String(args.labels).split(',') : undefined,
        assignee: args.assignee as string | undefined,
        author: args.author as string | undefined,
        milestone: args.milestone as string | undefined,
        limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
      });
      console.log(formatSuccess('list', { issues: result.issues, total: result.total }));
      break;
    }

    case 'create': {
      if (!args.title) {
        console.log(formatError('--title is required', 'github issues create --repo owner/repo --title "..."'));
        process.exit(1);
      }
      const result = await client.createIssue({
        repo,
        title: args.title as string,
        body: args.body as string | undefined,
        labels: args.labels ? String(args.labels).split(',') : undefined,
        assignee: args.assignee as string | undefined,
        milestone: args.milestone as string | undefined,
      });
      const { loadEnv } = await import('../shared/utils/env');
      const env = loadEnv();

      let taskInfo: { persisted: boolean; groupId?: string; error?: string } | undefined;
      if (env.STORAGE_MODE === 'local') {
        const { getCurrentGroupId } = await import('../shared/group-id');
        const { createTaskService } = await import('../shared/services');
        const {
          createNeo4jClient,
          createNeo4jConfigFromEnv,
          createMcpClient,
          createMcpConfigFromEnv,
        } = await import('../shared/clients');

        const rawGroup = args.group;
        const groupId =
          typeof rawGroup === 'string' && rawGroup.trim().length > 0
            ? rawGroup
            : getCurrentGroupId();
        const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv(env.raw));
        const mcpClient = createMcpClient(createMcpConfigFromEnv(env.raw));
        const taskService = createTaskService({
          neo4jClient,
          mcpClient,
          zepClient: null,
        });

        try {
          await persistCreatedIssueTask({
            tasks: taskService,
            groupId,
            repo,
            issue: {
              number: result.number,
              url: result.url,
              title: result.title,
              body: args.body as string | undefined,
              assignee: args.assignee as string | undefined,
            },
          });

          taskInfo = { persisted: true, groupId };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          taskInfo = { persisted: false, groupId, error: message };
        }
      }

      console.log(formatSuccess('create', { issue: result, task: taskInfo }));
      break;
    }

    case 'view': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Issue number is required', 'github issues view --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.viewIssue({ repo, number });
      console.log(formatSuccess('view', { issue: result }));
      break;
    }

    case 'close': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Issue number is required', 'github issues close --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.closeIssue({
        repo,
        number,
        reason: args.reason as 'completed' | 'not_planned' | undefined,
      });
      console.log(formatSuccess('close', { issue: result }));
      break;
    }

    case 'reopen': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Issue number is required', 'github issues reopen --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.reopenIssue({ repo, number });
      console.log(formatSuccess('reopen', { issue: result }));
      break;
    }

    case 'assign': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Issue number is required', 'github issues assign --repo owner/repo <number> --to user'));
        process.exit(1);
      }
      if (!args.to) {
        console.log(formatError('--to is required', 'github issues assign --repo owner/repo <number> --to user1,user2'));
        process.exit(1);
      }
      const assignees = String(args.to).split(',').map((s) => s.trim());
      const result = await client.assignIssue({ repo, number, assignees });
      console.log(formatSuccess('assign', { issue: result }));
      break;
    }

    case 'label': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Issue number is required', 'github issues label --repo owner/repo <number> --add x,y'));
        process.exit(1);
      }
      const add = args.add ? String(args.add).split(',').map((s) => s.trim()) : undefined;
      const remove = args.remove ? String(args.remove).split(',').map((s) => s.trim()) : undefined;
      if (!add && !remove) {
        console.log(formatError('--add or --remove is required', 'github issues label --repo owner/repo <number> --add label1,label2'));
        process.exit(1);
      }
      const result = await client.labelIssue({ repo, number, add, remove });
      console.log(formatSuccess('label', { issue: result }));
      break;
    }

    default:
      console.log(formatError(
        command ? `Unknown issues command: ${command}` : 'No command specified',
        'github issues <list|create|view|close|reopen|assign|label> --repo owner/repo'
      ));
      process.exit(1);
  }
}

async function handleProjects(
  command: string | null,
  args: Record<string, string | boolean>,
  positional: string[]
): Promise<void> {
  const { createGitHubClient } = await import('../shared/services');
  const { createGhCliClientFromEnv } = await import('../shared/clients');

  const ghCli = createGhCliClientFromEnv();
  const client = createGitHubClient(ghCli);

  const repo = args.repo as string;
  if (!repo && command !== 'help') {
    console.log(formatError('--repo owner/repo is required', 'github projects <command> --repo owner/repo'));
    process.exit(1);
  }

  switch (command) {
    case 'list': {
      const result = await client.listProjects({
        repo,
        limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
      });
      console.log(formatSuccess('list', { projects: result.projects, total: result.total }));
      break;
    }

    case 'view': {
      const number = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(number)) {
        console.log(formatError('Project number is required', 'github projects view --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.getProject({ repo, number });
      console.log(formatSuccess('view', { project: result }));
      break;
    }

    case 'items': {
      const projectNumber = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(projectNumber)) {
        console.log(formatError('Project number is required', 'github projects items --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.getProjectItems({
        repo,
        projectNumber,
        limit: args.limit ? parseInt(String(args.limit), 10) : undefined,
      });
      console.log(formatSuccess('items', { items: result.items, total: result.total }));
      break;
    }

    case 'fields': {
      const projectNumber = positional[0] ? parseInt(positional[0], 10) : NaN;
      if (isNaN(projectNumber)) {
        console.log(formatError('Project number is required', 'github projects fields --repo owner/repo <number>'));
        process.exit(1);
      }
      const result = await client.getProjectFields({ repo, projectNumber });
      console.log(formatSuccess('fields', { fields: result.fields }));
      break;
    }

    case 'add': {
      const projectNumber = positional[0] ? parseInt(positional[0], 10) : NaN;
      const issueNumber = positional[1] ? parseInt(positional[1], 10) : NaN;
      if (isNaN(projectNumber) || isNaN(issueNumber)) {
        console.log(formatError(
          'Project number and issue number are required',
          'github projects add --repo owner/repo <project-number> <issue-number>'
        ));
        process.exit(1);
      }
      const result = await client.addToProject({ repo, projectNumber, issueNumber });
      console.log(formatSuccess('add', { item: result }));
      break;
    }

    case 'set-field': {
      const projectNumber = positional[0] ? parseInt(positional[0], 10) : NaN;
      const itemId = positional[1];
      if (isNaN(projectNumber) || !itemId) {
        console.log(formatError(
          'Project number and item ID are required',
          'github projects set-field --repo owner/repo <project-number> <item-id> --field <name> --value <value>'
        ));
        process.exit(1);
      }
      if (!args.field || !args.value) {
        console.log(formatError(
          '--field and --value are required',
          'github projects set-field --repo owner/repo <project-number> <item-id> --field Status --value "In Progress"'
        ));
        process.exit(1);
      }
      const result = await client.setProjectField({
        repo,
        projectNumber,
        itemId,
        fieldName: args.field as string,
        value: args.value as string,
      });
      console.log(formatSuccess('set-field', { item: result }));
      break;
    }

    default:
      console.log(formatError(
        command ? `Unknown projects command: ${command}` : 'No command specified',
        'github projects <list|view|items|fields|add|set-field> --repo owner/repo'
      ));
      process.exit(1);
  }
}

async function handleSync(
  args: Record<string, string | boolean>
): Promise<void> {
  const { createGitHubClient, createGitHubSyncService, createTaskService } = await import('../shared/services');
  const {
    createGhCliClientFromEnv,
    createNeo4jClient,
    createNeo4jConfigFromEnv,
    createMcpClient,
    createMcpConfigFromEnv,
    createZepClient,
    createZepConfigFromEnv,
  } = await import('../shared/clients');

  const repo = args.repo as string;
  if (!repo) {
    console.log(formatError('--repo owner/repo is required', 'github sync --repo owner/repo [--import|--export] [--dry-run]'));
    process.exit(1);
  }

  // Determine sync direction
  let direction: 'import' | 'export' | 'bidirectional' = 'bidirectional';
  if (args.import && !args.export) {
    direction = 'import';
  } else if (args.export && !args.import) {
    direction = 'export';
  }

  // Get group ID (use canonical folder-based group, allow --group override)
  const { getCurrentGroupId } = await import('../shared/group-id');
  const rawGroup = args.group;
  if (rawGroup !== undefined && typeof rawGroup !== 'string') {
    console.log(formatError(
      '--group requires a value',
      'github sync --repo owner/repo [--import|--export] [--dry-run] [--group <id>]'
    ));
    process.exit(1);
  }
  const groupId =
    typeof rawGroup === 'string' && rawGroup.trim().length > 0
      ? rawGroup
      : getCurrentGroupId();

  // Create dependencies
  const ghCli = createGhCliClientFromEnv();
  const githubClient = createGitHubClient(ghCli);

  const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv());
  const mcpClient = createMcpClient(createMcpConfigFromEnv());
  const zepConfig = createZepConfigFromEnv();
  const zepClient = zepConfig ? createZepClient(zepConfig) : null;

  const taskService = createTaskService({
    neo4jClient,
    mcpClient,
    zepClient,
  });

  const syncService = createGitHubSyncService({
    github: githubClient,
    tasks: taskService,
  });

  // Parse labels
  const labels = args.labels ? String(args.labels).split(',').map((s) => s.trim()) : undefined;

  // Run sync
  const result = await syncService.sync({
    repo,
    direction,
    dryRun: Boolean(args['dry-run']),
    labels,
    groupId,
    defaultRepo: repo,
    defaultAssignee: '',
  });

  // Format output
  const output: Record<string, unknown> = {
    status: 'ok',
    action: 'sync',
    direction,
    dryRun: result.dryRun,
    summary: {
      imported: result.imported,
      exported: result.exported,
      updated: result.updated,
      skipped: result.skipped,
      conflicts: result.conflicts.length,
    },
  };

  if (result.importedItems.length > 0) {
    output.imported = result.importedItems;
  }
  if (result.exportedItems.length > 0) {
    output.exported = result.exportedItems;
  }
  if (result.updatedItems.length > 0) {
    output.updated = result.updatedItems;
  }
  if (result.conflicts.length > 0) {
    output.conflicts = result.conflicts;
  }

  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    const { subcommand, command, args, positional } = parseArgs(process.argv);

    if (!subcommand) {
      console.log(formatError(
        'No subcommand specified',
        'github <issues|projects|sync> <command> --repo owner/repo'
      ));
      process.exit(1);
    }

    switch (subcommand) {
      case 'issues':
        await handleIssues(command, args, positional);
        break;

      case 'projects':
        await handleProjects(command, args, positional);
        break;

      case 'sync':
        await handleSync(args);
        break;

      default:
        console.log(formatError(
          `Unknown subcommand: ${subcommand}`,
          'github <issues|projects|sync> <command> --repo owner/repo'
        ));
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(formatError(message));
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
