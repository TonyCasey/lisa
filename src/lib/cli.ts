#!/usr/bin/env node
import {Command} from 'commander';
import {spawn} from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import {createDefaultServices} from './services';
import {IScanOptions, runScan} from './scanner';
import {createLogger, withCorrelation} from './infrastructure';
import type {Neo4jConnectionManager} from './infrastructure/dal/connections';
import {bootstrapContainer, TOKENS} from './infrastructure/di';
import type {IMediator} from './application/mediator';
import {
  SessionStartRequest,
  SessionStopRequest,
  PromptSubmitRequest,
} from './application/mediator/requests';
import {
  readJsonFromStdin,
  writeJsonToStdout,
  writeStatus,
  parseTrigger,
  type ISessionStartInput,
  type ISessionStopInput,
  type IPromptSubmitInput,
  type IHookOutput,
} from './infrastructure/cli';
import {toISOTimestamp, type PermissionMode} from './domain';
import {createLabelInferenceService} from './infrastructure/services';
import {
  doctorCommand,
  initCommand,
  cleanupPreviousInstall,
  upCommand,
  downCommand,
  TEMPLATE_ROOT,
  VERSION,
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
  type DeploymentMode,
  type CliSupport,
} from './commands';

// Create CLI logger (console disabled by default to avoid interfering with CLI output)
const cliLogger = createLogger({ 
  enableConsole: process.env.LOG_CONSOLE === 'true',
  enableFile: process.env.LOG_FILE !== 'false',
});

// Command implementations moved to src/lib/commands/
// - initCommand, cleanupPreviousInstall -> init.ts
// - doctorCommand -> doctor.ts
// - upCommand, downCommand -> docker.ts

const program = new Command();
program
  .name('lisa')
  .description('Lisa remembers everything. Memory for Claude Code and AI assistants.')
  .version(VERSION);

program
  .command('init')
  .description('Scaffold .lisa, .claude/.opencode, and Docker assets')
  .option('-e, --endpoint <url>', 'MCP endpoint')
  .option('-g, --group <id>', 'Default group id')
  .option('-f, --force', 'Overwrite existing files')
  .option('-m, --mode <mode>', 'Deployment mode: local or zep-cloud')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .option('--isolated', 'Install to .claude/lib for non-npm projects (Python, Go, etc.)')
  .option('--claude-only', 'Only scaffold for Claude Code')
  .option('--opencode-only', 'Only scaffold for OpenCode')
  .option('-v, --verbose', 'Show detailed logging (default: true)', true)
  .option('-q, --quiet', 'Suppress detailed logging')
  .action(async (cmd) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'init' });
      const verbose = cmd.verbose && !cmd.quiet;
      log.info('Starting init command', { 
        mode: cmd.mode, 
        claudeOnly: cmd.claudeOnly, 
        opencodeOnly: cmd.opencodeOnly,
        verbose,
      });
      
      const services = createDefaultServices(TEMPLATE_ROOT);
      
      // Determine CLI support from flags
      let cliSupport: CliSupport[] | undefined;
      if (cmd.claudeOnly && !cmd.opencodeOnly) {
        cliSupport = ['claude-code'];
      } else if (cmd.opencodeOnly && !cmd.claudeOnly) {
        cliSupport = ['opencode'];
      } else if (cmd.claudeOnly && cmd.opencodeOnly) {
        cliSupport = ['claude-code', 'opencode'];
      }
      // If neither flag is set, cliSupport remains undefined and prompts will be shown
      
      await initCommand({
        endpoint: cmd.endpoint,
        group: cmd.group,
        force: cmd.force,
        cwd: process.cwd(),
        includeDocker: true,
        mode: cmd.mode as DeploymentMode | undefined,
        zepApiKey: cmd.zepApiKey,
        zepProjectId: cmd.zepProjectId,
        yes: cmd.yes,
        isolated: cmd.isolated,
        cliSupport,
        verbose,
      }, services);
      
      log.info('Init command completed');
    });
  });

program
  .command('setup')
  .description('Scaffold .lisa and .claude/.opencode only (no Docker assets)')
  .option('-e, --endpoint <url>', 'MCP endpoint')
  .option('-g, --group <id>', 'Default group id')
  .option('-f, --force', 'Overwrite existing files')
  .option('-m, --mode <mode>', 'Deployment mode: local or zep-cloud')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .option('--isolated', 'Install to .claude/lib for non-npm projects (Python, Go, etc.)')
  .option('--claude-only', 'Only scaffold for Claude Code')
  .option('--opencode-only', 'Only scaffold for OpenCode')
  .option('-v, --verbose', 'Show detailed logging (default: true)', true)
  .option('-q, --quiet', 'Suppress detailed logging')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    const verbose = cmd.verbose && !cmd.quiet;
    
    // Determine CLI support from flags
    let cliSupport: CliSupport[] | undefined;
    if (cmd.claudeOnly && !cmd.opencodeOnly) {
      cliSupport = ['claude-code'];
    } else if (cmd.opencodeOnly && !cmd.claudeOnly) {
      cliSupport = ['opencode'];
    } else if (cmd.claudeOnly && cmd.opencodeOnly) {
      cliSupport = ['claude-code', 'opencode'];
    }
    
    await initCommand({
      endpoint: cmd.endpoint,
      group: cmd.group,
      force: cmd.force,
      cwd: process.cwd(),
      includeDocker: false,
      mode: cmd.mode as DeploymentMode | undefined,
      zepApiKey: cmd.zepApiKey,
      zepProjectId: cmd.zepProjectId,
      yes: cmd.yes,
      isolated: cmd.isolated,
      cliSupport,
      verbose,
    }, services);
  });

program
  .command('up')
  .description('Start Neo4j/Graph/graphiti-mcp via docker compose')
  .option('-c, --compose <file>', 'Compose file', 'docker-compose.graphiti.yml')
  .action(async (cmd) => {
    const composeFile = path.resolve(process.cwd(), cmd.compose);
    const services = createDefaultServices(TEMPLATE_ROOT);
    await upCommand({ composeFile }, services);
  });

program
  .command('down')
  .description('Stop Neo4j/Graph/graphiti-mcp via docker compose')
  .option('-c, --compose <file>', 'Compose file', 'docker-compose.graphiti.yml')
  .action(async (cmd) => {
    const composeFile = path.resolve(process.cwd(), cmd.compose);
    const services = createDefaultServices(TEMPLATE_ROOT);
    await downCommand({ composeFile }, services);
  });

program
  .command('doctor')
  .description('Validate Lisa configuration and backend connectivity')
  .option('-c, --compose <file>', 'Compose file', 'docker-compose.graphiti.yml')
  .option('-e, --endpoint <url>', 'MCP endpoint override')
  .option('-v, --verbose', 'Show detailed diagnostics')
  .option('--json', 'Output results as JSON')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await doctorCommand({
      cwd: process.cwd(),
      compose: cmd.compose,
      endpoint: cmd.endpoint,
      verbose: cmd.verbose,
      json: cmd.json,
    }, services);
  });

program
  .command('scan [path]')
  .description('Scan a directory for projects and create solution-level knowledge')
  .option('--dry-run', 'Preview what would be discovered without storing facts')
  .option('--clean', 'Remove previous scan facts before adding new ones')
  .option('-v, --verbose', 'Show detailed output for each project')
  .action(async (targetPath: string | undefined, cmd) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'scan' });
      const scanPath = targetPath || process.cwd();
      
      log.info('Starting scan', { 
        path: scanPath, 
        dryRun: cmd.dryRun, 
        clean: cmd.clean,
        verbose: cmd.verbose,
      });
      
      const options: IScanOptions = {
        dryRun: cmd.dryRun,
        clean: cmd.clean,
        verbose: cmd.verbose,
      };

      try {
        const result = await runScan(scanPath, options);
        log.info('Scan completed', { 
          success: result.success,
          projectsFound: result.projectsFound,
          factsGenerated: result.factsGenerated,
        });
        process.exit(result.success ? 0 : 1);
      } catch (err) {
        log.error('Scan failed', { error: err instanceof Error ? err.message : String(err) });
        console.error(chalk.red(`Scan failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
  });

program
  .command('sync')
  .description('Sync copied directories (for Windows when symlinks fail)')
  .action(async () => {
    const cwd = process.cwd();
    const fallbackFile = path.join(cwd, '.lisa', '.copy-fallbacks.json');
    
    if (!await fs.pathExists(fallbackFile)) {
      console.log(chalk.yellow('No copy fallbacks found. Symlinks are working correctly.'));
      return;
    }
    
    try {
      const { copies } = await fs.readJson(fallbackFile) as { copies: Array<{ link: string; target: string }> };
      
      if (!copies || copies.length === 0) {
        console.log(chalk.yellow('No directories need syncing.'));
        return;
      }
      
      console.log(chalk.cyan(`Syncing ${copies.length} copied directories...`));
      
      for (const { link, target } of copies) {
        const linkPath = path.join(cwd, link);
        const targetPath = path.join(cwd, target);
        
        if (!await fs.pathExists(targetPath)) {
          console.log(chalk.yellow(`  Skipping ${link}: source ${target} not found`));
          continue;
        }
        
        await fs.remove(linkPath);
        await fs.copy(targetPath, linkPath);
        console.log(chalk.green(`  Synced: ${link}`));
      }
      
      console.log(chalk.green('Sync complete.'));
    } catch (err) {
      console.error(chalk.red(`Sync failed: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

function getSkillCacheEnv(skillName: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.LISA_SKILL_CACHE_DIR && !env.LISA_CACHE_DIR) {
    env.LISA_SKILL_CACHE_DIR = path.join(process.cwd(), '.lisa', 'skills', skillName, 'cache');
  }
  return env;
}

/**
 * Spawn a child process and wait for it to complete.
 * Returns a promise that resolves when the process exits successfully,
 * or rejects on error or non-zero exit code.
 */
function spawnAndWait(
  scriptPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      env: env || process.env,
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start skill: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Exit with the same code as the child process
        process.exit(code ?? 1);
      }
    });
  });
}

// Subcommand: lisa memory
const memoryCmd = program
  .command('memory')
  .description('Memory operations (load, add)');

memoryCmd
  .command('load')
  .description('Load memories from storage')
  .option('-g, --group <id>', 'Group ID')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('--cache', 'Use cache fallback')
  .action(async (opts) => {
    const args = ['load'];
    if (opts.group) args.push('--group', opts.group);
    if (opts.query) args.push('--query', opts.query);
    if (opts.limit) args.push('--limit', opts.limit);
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'memory', 'memory.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
  });

memoryCmd
  .command('add <text>')
  .description('Add a memory')
  .option('-g, --group <id>', 'Group ID')
  .option('-t, --tag <tag>', 'Tag for the memory')
  .option('--type <type>', 'Memory type')
  .option('--source <source>', 'Source identifier')
  .option('--cache', 'Use cache fallback')
  .action(async (text, opts) => {
    const args = ['add', text];
    if (opts.group) args.push('--group', opts.group);
    if (opts.tag) args.push('--tag', opts.tag);
    if (opts.type) args.push('--type', opts.type);
    if (opts.source) args.push('--source', opts.source);
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'memory', 'memory.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
  });

// Subcommand: lisa tasks
const tasksCmd = program
  .command('tasks')
  .description('Task operations (list, add, update)');

tasksCmd
  .command('list')
  .description('List tasks')
  .option('-g, --group <id>', 'Group ID')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('--cache', 'Use cache fallback')
  .action(async (opts) => {
    const args = ['list'];
    if (opts.group) args.push('--group', opts.group);
    if (opts.limit) args.push('--limit', opts.limit);
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'tasks', 'tasks.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('tasks'));
  });

tasksCmd
  .command('add <text>')
  .description('Add a task')
  .option('-g, --group <id>', 'Group ID')
  .option('-s, --status <status>', 'Task status (todo, doing, done)', 'todo')
  .option('-t, --tag <tag>', 'Tag for the task')
  .option('--cache', 'Use cache fallback')
  .action(async (text, opts) => {
    const args = ['add', text];
    if (opts.group) args.push('--group', opts.group);
    if (opts.status) args.push('--status', opts.status);
    if (opts.tag) args.push('--tag', opts.tag);
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'tasks', 'tasks.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('tasks'));
  });

tasksCmd
  .command('update <text>')
  .description('Update a task')
  .option('-g, --group <id>', 'Group ID')
  .option('-s, --status <status>', 'Task status (todo, doing, done)')
  .option('-t, --tag <tag>', 'Tag for the task')
  .option('--cache', 'Use cache fallback')
  .action(async (text, opts) => {
    const args = ['update', text];
    if (opts.group) args.push('--group', opts.group);
    if (opts.status) args.push('--status', opts.status);
    if (opts.tag) args.push('--tag', opts.tag);
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'tasks', 'tasks.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('tasks'));
  });

// Subcommand: lisa storage
const storageCmd = program
  .command('storage')
  .description('Storage operations (status, switch)');

storageCmd
  .command('status')
  .description('Show current storage mode and connection status')
  .option('--cache', 'Use cache fallback')
  .action(async (opts) => {
    const args = ['status'];
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'lisa', 'storage.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('lisa'));
  });

storageCmd
  .command('switch <mode>')
  .description('Switch storage mode (local, zep-cloud)')
  .option('--cache', 'Use cache fallback')
  .action(async (mode, opts) => {
    const args = ['switch', mode];
    if (opts.cache) args.push('--cache');
    const scriptPath = path.join(__dirname, 'skills', 'lisa', 'storage.js');
    await spawnAndWait(scriptPath, args, getSkillCacheEnv('lisa'));
  });

// Subcommand: lisa jira
program
  .command('jira')
  .description('Jira operations')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    // Pass all arguments after the command to the script
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'jira', 'jira.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa github
program
  .command('github')
  .description('GitHub Issues and Projects operations')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    // Pass all arguments after the command to the script
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'github', 'github.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa prompt
program
  .command('prompt')
  .description('Prompt operations')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'prompt', 'prompt.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa bump-version
program
  .command('bump-version')
  .description('Bump package version')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'git', 'bump-version.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa init-review
program
  .command('init-review')
  .description('Run initial codebase review')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'init-review', 'init-review.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa compile-skills
program
  .command('compile-skills')
  .description('Compile skill extensions')
  .allowUnknownOption()
  .action(async (_opts, cmd) => {
    const args = cmd.args || [];
    const scriptPath = path.join(__dirname, 'skills', 'lisa', 'compile-skills.js');
    await spawnAndWait(scriptPath, args);
  });

// Subcommand: lisa issue
// Wraps gh CLI with auto-labeling capabilities
const issueCmd = program
  .command('issue')
  .description('GitHub issue management with auto-labeling');

issueCmd
  .command('create')
  .description('Create a GitHub issue with automatic label inference')
  .requiredOption('-t, --title <title>', 'Issue title')
  .option('-b, --body <body>', 'Issue body')
  .option('-l, --label <labels...>', 'Explicit labels (skips auto-labeling for type)')
  .option('--no-auto-label', 'Disable automatic label inference')
  .option('-y, --yes', 'Skip confirmation, apply inferred labels automatically')
  .option('--dry-run', 'Show what would be created without creating')
  .action(async (opts) => {
    const title = opts.title;
    const body = opts.body || '';
    const explicitLabels: string[] = opts.label || [];
    const autoLabel = opts.autoLabel !== false;
    const skipConfirm = opts.yes || false;
    const dryRun = opts.dryRun || false;

    // Collect all labels
    const allLabels = [...explicitLabels];
    let inferredLabels: string[] = [];
    let reasons: Record<string, string> = {};

    // Auto-label if enabled and no explicit type labels provided
    if (autoLabel) {
      const service = createLabelInferenceService();
      const result = service.inferLabels(title, body);
      inferredLabels = result.labels;
      reasons = result.reasons;

      // Filter out labels that conflict with explicit labels
      const explicitTypes = explicitLabels.filter(l => 
        ['bug', 'enhancement', 'documentation', 'refactor', 'testing'].includes(l)
      );
      
      if (explicitTypes.length > 0) {
        // User specified a type label, don't override it
        inferredLabels = inferredLabels.filter(l => 
          !['bug', 'enhancement', 'documentation', 'refactor', 'testing'].includes(l)
        );
      }

      // Add non-duplicate inferred labels
      for (const label of inferredLabels) {
        if (!allLabels.includes(label)) {
          allLabels.push(label);
        }
      }
    }

    // Show what will be created
    console.log(chalk.bold('Issue to create:'));
    console.log(`  Title: ${chalk.cyan(title)}`);
    if (body) {
      const bodyPreview = body.length > 100 ? body.slice(0, 100) + '...' : body;
      console.log(`  Body: ${chalk.dim(bodyPreview)}`);
    }
    console.log('');

    if (explicitLabels.length > 0) {
      console.log(chalk.bold('Explicit labels:'));
      for (const label of explicitLabels) {
        console.log(`  ${chalk.green('+')} ${label}`);
      }
      console.log('');
    }

    if (inferredLabels.length > 0) {
      console.log(chalk.bold('Inferred labels:'));
      for (const label of inferredLabels) {
        const reason = reasons[label] || 'Pattern match';
        console.log(`  ${chalk.yellow('~')} ${label} ${chalk.dim(`(${reason})`)}`);
      }
      console.log('');
    }

    if (allLabels.length > 0) {
      console.log(chalk.bold('Final labels:'));
      console.log(`  ${allLabels.join(', ')}`);
      console.log('');
    }

    if (dryRun) {
      console.log(chalk.yellow('Dry run - no issue created'));
      return;
    }

    // Confirm if not skipping
    if (!skipConfirm && inferredLabels.length > 0) {
      const { confirm } = await import('@inquirer/prompts');
      const confirmed = await confirm({
        message: 'Create issue with these labels?',
        default: true,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled'));
        return;
      }
    }

    // Build gh command
    const ghArgs = ['issue', 'create', '--title', title];
    
    if (body) {
      ghArgs.push('--body', body);
    }

    for (const label of allLabels) {
      ghArgs.push('--label', label);
    }

    // Execute gh command using spawnSync to avoid shell injection
    try {
      const { spawnSync } = await import('child_process');
      const result = spawnSync('gh', ghArgs, {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
        shell: false,
      });

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        throw new Error(`gh exited with code ${result.status}`);
      }
      
      console.log(chalk.green('Issue created:'), (result.stdout || '').trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red('Failed to create issue:'), message);
      process.exit(1);
    }
  });

issueCmd
  .command('labels')
  .description('Infer labels for content without creating an issue')
  .requiredOption('-t, --title <title>', 'Issue title to analyze')
  .option('-b, --body <body>', 'Issue body to analyze')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const service = createLabelInferenceService();
    const result = service.inferLabels(opts.title, opts.body || '');

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.labels.length === 0) {
        console.log(chalk.yellow('No labels inferred'));
      } else {
        console.log(chalk.bold('Inferred labels:'));
        for (const label of result.labels) {
          const reason = result.reasons[label] || 'Pattern match';
          console.log(`  ${chalk.green('+')} ${label}`);
          console.log(`    ${chalk.dim(reason)}`);
        }
        console.log('');
        console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      }
    }
  });

// Subcommand: lisa pr
// PR workflow commands (checks, comments, watch)
const prCmd = program
  .command('pr')
  .description('PR workflow operations (checks, comments, watch)');

prCmd
  .command('checks <pr-number>')
  .description('Get CI check status for a PR')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .option('--json', 'Output as JSON')
  .option('--no-save', 'Do not save results to Neo4j')
  .action(async (prNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr checks' });
      log.info('Fetching PR checks', { prNumber, repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrChecksHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrChecksHandler(githubClient, prRepository);
        const result = await handler.execute({
          prNumber: parseInt(prNumber, 10),
          repo: opts.repo,
          saveToNeo4j: opts.save !== false,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold(`PR #${result.prNumber} Checks`));
          if (result.title) {
            console.log(chalk.dim(result.title));
          }
          console.log('');
          console.log(result.summary);
          console.log('');

          for (const check of result.checks) {
            const statusSymbol = {
              success: chalk.green('✓'),
              failure: chalk.red('✗'),
              pending: chalk.yellow('○'),
              cancelled: chalk.gray('○'),
              skipped: chalk.gray('-'),
            };
            console.log(`  ${statusSymbol[check.status]} ${check.name}`);
            if (check.detailsUrl && check.status === 'failure') {
              console.log(`    ${chalk.dim(check.detailsUrl)}`);
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to fetch PR checks', { error: message });
        console.error(chalk.red(`Failed to fetch checks: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('comments <pr-number>')
  .description('Fetch and display PR review comments')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .option('-f, --filter <status>', 'Filter by status (pending, addressed, resolved)')
  .option('--json', 'Output as JSON')
  .option('--no-save', 'Do not save results to Neo4j')
  .action(async (prNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr comments' });
      log.info('Fetching PR comments', { prNumber, repo: opts.repo, filter: opts.filter });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrCommentsHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrCommentsHandler(githubClient, prRepository);
        const result = await handler.execute({
          prNumber: parseInt(prNumber, 10),
          repo: opts.repo,
          filter: opts.filter,
          saveToNeo4j: opts.save !== false,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.formattedOutput);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to fetch PR comments', { error: message });
        console.error(chalk.red(`Failed to fetch comments: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('watch <pr-number>')
  .description('Start watching a PR for updates')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .action(async (prNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr watch' });
      log.info('Watching PR', { prNumber, repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrWatchHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrWatchHandler(githubClient, prRepository);
        const result = await handler.watch({
          prNumber: parseInt(prNumber, 10),
          repo: opts.repo,
        });

        if (result.success) {
          console.log(chalk.green(result.message));
        } else {
          console.error(chalk.red(result.message));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to watch PR', { error: message });
        console.error(chalk.red(`Failed to watch PR: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('unwatch <pr-number>')
  .description('Stop watching a PR')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .action(async (prNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr unwatch' });
      log.info('Unwatching PR', { prNumber, repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrWatchHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrWatchHandler(githubClient, prRepository);
        const result = await handler.unwatch({
          prNumber: parseInt(prNumber, 10),
          repo: opts.repo,
        });

        if (result.success) {
          console.log(chalk.green(result.message));
        } else {
          console.error(chalk.red(result.message));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to unwatch PR', { error: message });
        console.error(chalk.red(`Failed to unwatch PR: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('watching')
  .description('List all PRs being watched')
  .option('-r, --repo <repo>', 'Filter by repository (owner/repo format)')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr watching' });
      log.info('Listing watched PRs', { repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrWatchHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrWatchHandler(githubClient, prRepository);
        const result = await handler.list({
          repo: opts.repo,
          limit: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold(result.message));
          console.log('');

          if (result.watchedPrs && result.watchedPrs.length > 0) {
            for (const pr of result.watchedPrs) {
              const statusEmoji = {
                open: '🟢',
                merged: '🟣',
                closed: '⚪',
              };
              const checksEmoji = {
                success: '✅',
                failure: '❌',
                pending: '⏳',
                cancelled: '⚪',
                skipped: '⚪',
              };

              console.log(`${statusEmoji[pr.status]} #${pr.number} ${pr.title}`);
              console.log(`   ${chalk.dim(pr.repo)} ${checksEmoji[pr.checksStatus]} ${pr.unresolvedComments > 0 ? `💬${pr.unresolvedComments}` : ''}`);
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to list watched PRs', { error: message });
        console.error(chalk.red(`Failed to list watched PRs: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

// Subcommand: lisa hook
// These commands are called by Claude Code via settings.json hooks
const hookCmd = program
  .command('hook')
  .description('Hook commands for Claude Code integration');

hookCmd
  .command('session-start')
  .description('Handle session start event (called by Claude Code)')
  .action(async () => {
    let dispose: (() => Promise<void>) | undefined;
    try {
      // Read input from Claude Code
      const input = await readJsonFromStdin<ISessionStartInput>();
      const trigger = parseTrigger(input.source, input.session_type, input.trigger);

      // Bootstrap container and resolve mediator
      const bootstrap = await bootstrapContainer({
        projectRoot: input.cwd || process.cwd(),
        disableLogging: true,
      });
      dispose = bootstrap.dispose;

      const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

      // Create and send request
      const request = new SessionStartRequest(trigger, toISOTimestamp(), input.session_id);
      const result = await mediator.send(request);

      // Output context to stdout (goes to Claude)
      const output: IHookOutput = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: result.contextContent,
        },
      };
      await writeJsonToStdout(output);

      // Status message to stderr (shown to user)
      await writeStatus(result.message);
    } catch (error) {
      // On error, still output something to not block session
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output: IHookOutput = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `Memory load skipped: ${errorMessage}`,
        },
      };
      await writeJsonToStdout(output);
      await writeStatus(`Memory load failed: ${errorMessage}`);
    } finally {
      if (dispose) await dispose();
    }
  });

hookCmd
  .command('session-stop')
  .description('Handle session stop event (called by Claude Code)')
  .action(async () => {
    let dispose: (() => Promise<void>) | undefined;
    try {
      // Read input from Claude Code
      const input = await readJsonFromStdin<ISessionStopInput>();

      // Bootstrap container and resolve mediator
      const bootstrap = await bootstrapContainer({
        projectRoot: input.cwd || process.cwd(),
        disableLogging: true,
      });
      dispose = bootstrap.dispose;

      const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

      // Create and send request
      const request = new SessionStopRequest(
        'idle',
        toISOTimestamp(),
        input.session_id,
        input.transcript_path
      );
      const result = await mediator.send(request);

      // Status message to stderr
      await writeStatus(result.message);
    } catch (error) {
      // Silent failure - don't block user
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeStatus(`Session capture failed: ${errorMessage}`);
    } finally {
      if (dispose) await dispose();
    }
  });

hookCmd
  .command('user-prompt-submit')
  .description('Handle user prompt submit event (called by Claude Code)')
  .action(async () => {
    let dispose: (() => Promise<void>) | undefined;
    try {
      // Read input from Claude Code
      const input = await readJsonFromStdin<IPromptSubmitInput>();
      const content = input.prompt || input.content || '';
      const permissionMode = (input.permission_mode || input.permissionMode || 'default') as PermissionMode;

      if (!content) {
        // No content to process
        return;
      }

      // Bootstrap container and resolve mediator
      const bootstrap = await bootstrapContainer({
        projectRoot: process.cwd(),
        disableLogging: true,
      });
      dispose = bootstrap.dispose;

      const mediator = await bootstrap.container.resolve<IMediator>(TOKENS.Mediator);

      // Create and send request
      const request = new PromptSubmitRequest(content, toISOTimestamp(), input.session_id, permissionMode);
      const result = await mediator.send(request);

      // Output recursion results if in plan mode
      if (result.recursion?.hasContext) {
        console.log('\n🔍 Related Context from Memory:\n');
        console.log(result.recursion.summary);
        console.log('');
      }
    } catch {
      // Silent failure - don't block user
    } finally {
      if (dispose) await dispose();
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red(err.message));
    process.exit(1);
  });
}

export {
  initCommand,
  doctorCommand,
  upCommand,
  downCommand,
  createDefaultServices,
  cleanupPreviousInstall,
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
  TEMPLATE_ROOT,
  runScan,
};
