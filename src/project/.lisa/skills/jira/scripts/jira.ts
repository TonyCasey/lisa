#!/usr/bin/env node
/**
 * Jira CLI - thin entry point.
 *
 * Commands:
 *   node jira.js create --type <type> --project <key> --summary "..." [--description "..."] [--parent KEY] [--assign me]
 *   node jira.js list [--project <key>] [--jql "..."] [--mine] [--limit N]
 *   node jira.js view <issue-key>
 *   node jira.js assign <issue-key> --to <user|me>
 *   node jira.js transition <issue-key> --to "Status Name"
 *   node jira.js change-type <issue-key> --to <epic|story|task|subtask|bug>
 */

export {};

interface IParsedArgs {
  command: string | null;
  args: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): IParsedArgs {
  const args: Record<string, string | boolean> = {};
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
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, args, positional };
}

async function main(): Promise<void> {
  const { createJiraClient, loadJiraConfig } = await import('../../shared/services');

  try {
    const { command, args, positional } = parseArgs(process.argv);

    if (!command) {
      console.log(JSON.stringify({
        status: 'error',
        error: 'No command specified',
        usage: 'jira.js <create|list|view|assign|transition|change-type> [options]',
      }));
      process.exit(1);
    }

    const config = loadJiraConfig();
    const client = createJiraClient(config);

    let result: Record<string, unknown>;

    switch (command) {
      case 'create':
        if (!args.type || !args.project || !args.summary) {
          throw new Error('create requires --type, --project, --summary');
        }
        const issue = await client.createIssue({
          type: args.type as string,
          project: args.project as string,
          summary: args.summary as string,
          description: args.description as string | undefined,
          parent: args.parent as string | undefined,
          assign: args.assign as string | undefined,
        });
        result = { status: 'ok', action: 'create', issue };
        break;

      case 'list':
        const listResult = await client.listIssues({
          project: args.project as string | undefined,
          jql: args.jql as string | undefined,
          mine: args.mine === true,
          limit: args.limit ? parseInt(args.limit as string) : undefined,
        });
        result = { status: 'ok', action: 'list', ...listResult };
        break;

      case 'view':
        const issueKey = positional[0] || (args.issue as string);
        if (!issueKey) throw new Error('Issue key required');
        const viewResult = await client.viewIssue(issueKey);
        result = { status: 'ok', action: 'view', issue: viewResult };
        break;

      case 'assign':
        const assignKey = positional[0] || (args.issue as string);
        if (!assignKey || !args.to) throw new Error('assign requires issue key and --to');
        const assignResult = await client.assignIssue(assignKey, { to: args.to as string });
        result = { status: 'ok', action: 'assign', ...assignResult };
        break;

      case 'transition':
        const transKey = positional[0] || (args.issue as string);
        if (!transKey || !args.to) throw new Error('transition requires issue key and --to');
        const transResult = await client.transitionIssue(transKey, { to: args.to as string });
        result = { status: 'ok', action: 'transition', ...transResult };
        break;

      case 'change-type':
        const changeKey = positional[0] || (args.issue as string);
        if (!changeKey || !args.to) throw new Error('change-type requires issue key and --to');
        const changeResult = await client.changeIssueType(changeKey, { to: args.to as string });
        result = { status: 'ok', action: 'change-type', issue: changeResult };
        break;

      default:
        result = {
          status: 'error',
          error: `Unknown command: ${command}`,
          available: ['create', 'list', 'view', 'assign', 'transition', 'change-type'],
        };
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  }
}

main();
