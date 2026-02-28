#!/usr/bin/env node
import {Command} from 'commander';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import {createCliServices} from './commands/cli-services';
import {IScanOptions, runScan} from './scanner';
import {createLogger, withCorrelation} from './infrastructure';
import {
  CliExitError,
  doctorCommand,
  initCommand,
  cleanupPreviousInstall,
  registerHookCommands,
  registerKnowledgeCommands,
  registerSkillCommands,
  registerIssueCommands,
  registerPrCommands,
  TEMPLATE_ROOT,
  VERSION,
  DEFAULT_GROUP,
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
// - hook commands -> hooks.ts
// - memory, tasks, storage -> knowledge.ts
// - jira, github, prompt, etc. -> skills.ts
// - issue create, labels -> issue.ts
// - pr commands -> pr.ts

const program = new Command();
program
  .name('lisa')
  .description('Lisa remembers everything. Memory for Claude Code and AI assistants.')
  .version(VERSION);

program
  .command('init')
  .description('Scaffold .lisa and .claude/.opencode directories')
  .option('-f, --force', 'Overwrite existing files')
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
        claudeOnly: cmd.claudeOnly,
        opencodeOnly: cmd.opencodeOnly,
        verbose,
      });

      const services = createCliServices(TEMPLATE_ROOT);

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
        force: cmd.force,
        cwd: process.cwd(),
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
  .description('Alias for init - scaffold .lisa and .claude/.opencode directories')
  .option('-f, --force', 'Overwrite existing files')
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
    const services = createCliServices(TEMPLATE_ROOT);
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
      force: cmd.force,
      cwd: process.cwd(),
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
  .command('doctor')
  .description('Validate Lisa configuration and setup')
  .option('-v, --verbose', 'Show detailed diagnostics')
  .option('--json', 'Output results as JSON')
  .action(async (cmd) => {
    const services = createCliServices(TEMPLATE_ROOT);
    await doctorCommand({
      cwd: process.cwd(),
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
        if (!result.success) {
          throw new CliExitError(1, 'Scan completed with errors');
        }
      } catch (err) {
        if (err instanceof CliExitError) throw err;
        log.error('Scan failed', { error: err instanceof Error ? err.message : String(err) });
        throw new CliExitError(1, `Scan failed: ${err instanceof Error ? err.message : err}`);
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
      throw new CliExitError(1, `Sync failed: ${err instanceof Error ? err.message : err}`);
    }
  });

// Register extracted command groups
registerKnowledgeCommands(program);
registerSkillCommands(program);

const issueCmd = program
  .command('issue')
  .description('GitHub issue management with auto-labeling');
registerIssueCommands(issueCmd);

const prCmd = program
  .command('pr')
  .description('PR workflow operations (create, checks, comments, watch)');
registerPrCommands(prCmd, cliLogger);

const hookCmd = program
  .command('hook')
  .description('Hook commands for Claude Code integration');
registerHookCommands(hookCmd);

if (require.main === module) {
  program.parseAsync(process.argv).catch((err) => {
    if (err instanceof CliExitError) {
      if (err.message) console.error(chalk.red(err.message));
      process.exit(err.exitCode);
      return;
    }
    console.error(chalk.red(err.message));
    process.exit(1);
  });
}

export {
  initCommand,
  doctorCommand,
  cleanupPreviousInstall,
  DEFAULT_GROUP,
  TEMPLATE_ROOT,
  runScan,
};
export { createCliServices } from './commands/cli-services';
