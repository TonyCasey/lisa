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
  .option('--skip-pr-polling', 'Skip PR polling setup')
  .option('--enable-pr-polling', 'Enable PR polling (for -y mode)')
  .option('--pr-polling-notify', 'Enable desktop notifications for PR polling')
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
        skipPrPolling: cmd.skipPrPolling,
        enablePrPolling: cmd.enablePrPolling,
        prPollingNotify: cmd.prPollingNotify,
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
  .option('--skip-pr-polling', 'Skip PR polling setup')
  .option('--enable-pr-polling', 'Enable PR polling (for -y mode)')
  .option('--pr-polling-notify', 'Enable desktop notifications for PR polling')
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
      skipPrPolling: cmd.skipPrPolling,
      enablePrPolling: cmd.enablePrPolling,
      prPollingNotify: cmd.prPollingNotify,
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
  .option('--since <date>', 'Filter memories created after date (ISO or relative: today, yesterday, 7d, 1w, 1m)')
  .option('--until <date>', 'Filter memories created before date')
  .option('--cache', 'Use cache fallback')
  .action(async (opts) => {
    const args = ['load'];
    if (opts.group) args.push('--group', opts.group);
    if (opts.query) args.push('--query', opts.query);
    if (opts.limit) args.push('--limit', opts.limit);
    if (opts.since) args.push('--since', opts.since);
    if (opts.until) args.push('--until', opts.until);
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
  .option('--since <date>', 'Filter tasks created after date (ISO or relative: today, yesterday, 7d, 1w, 1m)')
  .option('--until <date>', 'Filter tasks created before date')
  .option('--cache', 'Use cache fallback')
  .action(async (opts) => {
    const args = ['list'];
    if (opts.group) args.push('--group', opts.group);
    if (opts.limit) args.push('--limit', opts.limit);
    if (opts.since) args.push('--since', opts.since);
    if (opts.until) args.push('--until', opts.until);
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
// PR workflow commands (create, checks, comments, watch)
const prCmd = program
  .command('pr')
  .description('PR workflow operations (create, checks, comments, watch)');

prCmd
  .command('create')
  .description('Create a PR with auto-generated body and issue linking')
  .option('-i, --issue <numbers...>', 'Issue number(s) to link (comma-separated)')
  .option('-b, --base <branch>', 'Target branch (default: main/master)')
  .option('-t, --title <title>', 'PR title (default: from issue or first commit)')
  .option('-d, --draft', 'Create as draft PR')
  .option('--no-watch', 'Skip auto-watching the PR')
  .option('--no-comment', 'Skip commenting on linked issues')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr create' });
      log.info('Creating PR', { issues: opts.issue, base: opts.base, draft: opts.draft });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrCreateHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        // Parse issue numbers
        let issues: number[] | undefined;
        if (opts.issue) {
          issues = opts.issue.flatMap((i: string) => 
            i.split(',').map((n: string) => parseInt(n.trim(), 10))
          ).filter((n: number) => !isNaN(n));
        }

        const handler = new PrCreateHandler(githubClient, prRepository);
        const result = await handler.execute({
          issues,
          base: opts.base,
          title: opts.title,
          draft: opts.draft,
          noWatch: opts.watch === false,
          noComment: opts.comment === false,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.success) {
            process.exit(1);
          }
        } else if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
          if (result.linkedIssues && result.linkedIssues.length > 0) {
            console.log(chalk.dim(`  Linked issues: ${result.linkedIssues.map((i: number) => `#${i}`).join(', ')}`));
          }
          if (result.pr) {
            console.log('');
            console.log(chalk.bold('PR Body:'));
            console.log(chalk.dim('─'.repeat(60)));
            console.log(result.body);
            console.log(chalk.dim('─'.repeat(60)));
          }
        } else {
          console.error(chalk.red(`✗ ${result.message}`));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to create PR', { error: message });
        console.error(chalk.red(`Failed to create PR: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('review')
  .description('Run local AI code review on current branch diff')
  .option('-b, --base <branch>', 'Base branch to diff against (default: main/master)')
  .option('--block', 'Exit non-zero if critical issues found')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr review' });
      log.info('Running PR review', { base: opts.base, block: opts.block });

      try {
        const { PrReviewHandler } = await import('./application/handlers');
        
        const handler = new PrReviewHandler();
        const result = await handler.execute({
          base: opts.base,
          block: opts.block,
          json: opts.json,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          if (result.shouldBlock) {
            process.exit(1);
          }
        } else {
          // Header
          console.log('');
          console.log(chalk.bold(`Reviewing changes: ${result.base}...HEAD (${result.filesChanged} files changed)`));
          console.log('');

          if (result.reviewError) {
            console.log(chalk.yellow(`⚠ ${result.reviewError}`));
            console.log(chalk.dim('Using fallback heuristic review...'));
            console.log('');
          }

          if (result.issues.length === 0 && result.passed.length === 0) {
            console.log(chalk.green('✓ No issues found'));
          } else {
            console.log(chalk.bold('## Review Summary'));
            console.log('');

            // Critical issues
            const critical = result.issues.filter((i: { severity: string }) => i.severity === 'critical');
            if (critical.length > 0) {
              console.log(chalk.red.bold(`### 🔴 Critical (must fix) - ${critical.length}`));
              for (const issue of critical) {
                const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                console.log(chalk.red(`- ${location} - ${issue.message}`));
              }
              console.log('');
            }

            // Warnings
            const warnings = result.issues.filter((i: { severity: string }) => i.severity === 'warning');
            if (warnings.length > 0) {
              console.log(chalk.yellow.bold(`### 🟡 Warnings (should fix) - ${warnings.length}`));
              for (const issue of warnings) {
                const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                console.log(chalk.yellow(`- ${location} - ${issue.message}`));
              }
              console.log('');
            }

            // Suggestions
            const suggestions = result.issues.filter((i: { severity: string }) => i.severity === 'suggestion');
            if (suggestions.length > 0) {
              console.log(chalk.cyan.bold(`### 🟢 Suggestions (nice to have) - ${suggestions.length}`));
              for (const issue of suggestions) {
                const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                console.log(chalk.cyan(`- ${location} - ${issue.message}`));
              }
              console.log('');
            }

            // Passed checks
            if (result.passed.length > 0) {
              console.log(chalk.green.bold('### ✅ Passed'));
              for (const check of result.passed) {
                console.log(chalk.green(`- ${check}`));
              }
              console.log('');
            }
          }

          // Summary line
          console.log(chalk.dim('─'.repeat(60)));
          console.log(`Result: ${chalk.red(`${result.counts.critical} critical`)}, ${chalk.yellow(`${result.counts.warning} warning`)}, ${chalk.cyan(`${result.counts.suggestion} suggestion`)}`);

          if (result.shouldBlock) {
            console.log('');
            console.log(chalk.red.bold('✗ Review failed: critical issues must be fixed before merge'));
            process.exit(1);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to run review', { error: message });
        console.error(chalk.red(`Failed to run review: ${message}`));
        process.exit(1);
      }
    });
  });

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
  .command('address <pr-number>')
  .description('Fetch pending comments and prepare them for addressing')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .option('--include-resolved', 'Include already resolved comments')
  .option('-c, --context <lines>', 'Lines of code context (default: 10)', '10')
  .option('--json', 'Output as JSON')
  .action(async (prNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr address' });
      log.info('Preparing PR comments for addressing', { prNumber, repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrAddressHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrAddressHandler(githubClient, prRepository);
        const result = await handler.execute({
          prNumber: parseInt(prNumber, 10),
          repo: opts.repo,
          includeResolved: opts.includeResolved,
          codeContextLines: parseInt(opts.context, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.formattedOutput);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to prepare PR comments', { error: message });
        console.error(chalk.red(`Failed to prepare comments: ${message}`));
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
  .command('link <pr-number> <issue-number>')
  .description('Link a PR to an issue (creates CLOSES relationship)')
  .option('-r, --repo <repo>', 'Repository (owner/repo format)')
  .option('--no-comment', 'Skip commenting on the GitHub issue')
  .option('--json', 'Output as JSON')
  .action(async (prNumber: string, issueNumber: string, opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr link' });

      // Validate PR and issue numbers before proceeding
      const parsedPrNumber = parseInt(prNumber, 10);
      const parsedIssueNumber = parseInt(issueNumber, 10);
      if (!Number.isFinite(parsedPrNumber) || parsedPrNumber <= 0 ||
          !Number.isFinite(parsedIssueNumber) || parsedIssueNumber <= 0) {
        console.error(chalk.red('PR and Issue numbers must be positive integers.'));
        process.exit(1);
      }

      log.info('Linking PR to issue', { prNumber: parsedPrNumber, issueNumber: parsedIssueNumber, repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrLinkHandler } = await import('./application/handlers');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrLinkHandler(githubClient, prRepository);
        const result = await handler.execute({
          prNumber: parsedPrNumber,
          issueNumber: parsedIssueNumber,
          repo: opts.repo,
          noComment: opts.comment === false,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.success) {
            process.exit(1);
          }
        } else if (result.success) {
          if (result.alreadyLinked) {
            console.log(chalk.yellow(`⚠ PR #${prNumber} is already linked to Issue #${issueNumber}`));
          } else {
            console.log(chalk.green(`✓ Linked PR #${prNumber} to Issue #${issueNumber}`));
            if (result.pr) {
              console.log(chalk.dim(`  PR: ${result.pr.url}`));
            }
            if (result.issue) {
              console.log(chalk.dim(`  Issue: ${result.issue.url}`));
            }
          }
        } else {
          console.error(chalk.red(`✗ ${result.message}`));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to link PR to issue', { error: message });
        console.error(chalk.red(`Failed to link: ${message}`));
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

prCmd
  .command('status')
  .description('Show status summary of all watched PRs')
  .option('-r, --repo <repo>', 'Filter by repository (owner/repo format)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr status' });
      log.info('Getting PR status summary', { repo: opts.repo });

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrStatusHandler } = await import('./application/handlers');

        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        const handler = new PrStatusHandler(prRepository);
        const result = await handler.execute({
          repo: opts.repo,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.success) {
            process.exit(1);
          }
        } else if (result.success) {
          console.log(result.formattedOutput);
        } else {
          console.error(chalk.red(result.message));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to get PR status', { error: message });
        console.error(chalk.red(`Failed to get PR status: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

prCmd
  .command('poll')
  .description('Poll all watched PRs for state changes (for cron)')
  .option('--no-auto-unwatch', 'Do not auto-unwatch merged/closed PRs')
  .option('--no-log', 'Do not write to log file')
  .option('-c, --concurrency <n>', 'Max concurrent GitHub API calls', '5')
  .option('--notify', 'Send desktop notifications for state changes')
  .option('--no-auto-address', 'Do not auto-address new comments')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr poll' });
      log.info('Polling watched PRs');

      let neo4jConnection: Neo4jConnectionManager | undefined;
      try {
        const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('./infrastructure');
        const { PrPollHandler } = await import('./application/handlers');
        const { NotificationService } = await import('./infrastructure/notifications');

        const githubClient = new GithubClient();
        neo4jConnection = createNeo4jConnectionManager();
        const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

        // Create notification service if --notify flag is set
        const notificationService = opts.notify ? new NotificationService() : undefined;
        const handler = new PrPollHandler(githubClient, prRepository, notificationService);
        const parsedConcurrency = parseInt(opts.concurrency, 10);
        const result = await handler.poll({
          autoUnwatch: opts.autoUnwatch,
          logToFile: opts.log,
          concurrency: Number.isFinite(parsedConcurrency) ? parsedConcurrency : 5,
          notify: opts.notify,
          autoAddress: opts.autoAddress,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold(result.message));

          if (result.items.length > 0) {
            console.log('');
            for (const item of result.items) {
              if (item.error) {
                console.log(chalk.red(`  ❌ ${item.repo}#${item.number}: ${item.error}`));
              } else if (item.changes.length > 0) {
                for (const change of item.changes) {
                  console.log(chalk.yellow(`  📢 ${item.repo}#${item.number}: ${change.description}`));
                }
                if (item.unwatched) {
                  console.log(chalk.dim(`     (unwatched)`));
                }
              } else {
                console.log(chalk.dim(`  ✓ ${item.repo}#${item.number}: no changes`));
              }
            }
          }

          if (result.logPath) {
            console.log('');
            console.log(chalk.dim(`Log: ${result.logPath}`));
          }

          // Display auto-address output if available
          if (result.addressOutput && result.addressOutput.length > 0) {
            console.log('');
            console.log(chalk.bold.cyan('--- Auto-Address Output ---'));
            for (const addr of result.addressOutput) {
              console.log('');
              console.log(addr.formattedOutput);
            }
          }
        }

        // Exit with error code if there were errors
        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to poll PRs', { error: message });
        console.error(chalk.red(`Failed to poll PRs: ${message}`));
        process.exit(1);
      } finally {
        if (neo4jConnection) {
          await neo4jConnection.disconnect();
        }
      }
    });
  });

// Subcommand: lisa pr cron
const prCronCmd = prCmd
  .command('cron')
  .description('Manage PR polling cron job');

prCronCmd
  .command('install')
  .description('Install cron job for PR polling')
  .option('--notify', 'Enable desktop notifications', true)
  .option('--no-notify', 'Disable desktop notifications')
  .option('-i, --interval <minutes>', 'Polling interval in minutes', '5')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr cron install' });
      log.info('Installing PR polling cron job');

      try {
        const { CronService } = await import('./infrastructure/cron');
        const cronService = new CronService();

        const intervalMinutes = parseInt(opts.interval, 10);
        if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
          console.error(chalk.red('Invalid interval. Must be at least 1 minute.'));
          process.exit(1);
        }

        const result = await cronService.install({
          name: 'lisa-pr-poll',
          command: 'lisa pr poll',
          intervalMinutes,
          notify: opts.notify,
        });

        if (result.success) {
          const notifyStr = opts.notify ? ' --notify' : '';
          console.log(chalk.green(`Installed ${result.platform} job: lisa pr poll${notifyStr}`));
          console.log(chalk.green(`Polling every ${intervalMinutes} minute(s).`));
          console.log('');
          console.log(chalk.cyan('PR monitoring is now active.'));
          console.log(chalk.cyan('Use `lisa pr watch <number>` to start tracking PRs.'));
        } else {
          console.error(chalk.red(`Failed to install: ${result.error}`));
          if (result.manualInstructions) {
            console.log('');
            console.log(chalk.cyan('Manual installation:'));
            console.log(result.manualInstructions);
          }
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to install cron job', { error: message });
        console.error(chalk.red(`Failed to install: ${message}`));
        process.exit(1);
      }
    });
  });

prCronCmd
  .command('uninstall')
  .description('Remove PR polling cron job')
  .action(async () => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr cron uninstall' });
      log.info('Uninstalling PR polling cron job');

      try {
        const { CronService } = await import('./infrastructure/cron');
        const cronService = new CronService();

        const result = await cronService.uninstall();

        if (result.success) {
          console.log(chalk.green('PR polling cron job removed.'));
        } else {
          console.error(chalk.red(`Failed to uninstall: ${result.error}`));
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to uninstall cron job', { error: message });
        console.error(chalk.red(`Failed to uninstall: ${message}`));
        process.exit(1);
      }
    });
  });

prCronCmd
  .command('status')
  .description('Check PR polling cron job status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'pr cron status' });
      log.info('Checking PR polling cron job status');

      try {
        const { CronService } = await import('./infrastructure/cron');
        const cronService = new CronService();

        const platform = cronService.getPlatform();
        const status = await cronService.isInstalled();
        const config = await cronService.getConfig();

        if (opts.json) {
          console.log(JSON.stringify({ platform, status, config }, null, 2));
        } else {
          console.log(`Platform: ${platform}`);
          console.log(`Status: ${status}`);
          if (config) {
            console.log(`Enabled: ${config.enabled}`);
            console.log(`Interval: ${config.intervalMinutes} minutes`);
            console.log(`Notifications: ${config.notify ? 'enabled' : 'disabled'}`);
            console.log(`Setup: ${config.setupAt}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Failed to check status', { error: message });
        console.error(chalk.red(`Failed to check status: ${message}`));
        process.exit(1);
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
