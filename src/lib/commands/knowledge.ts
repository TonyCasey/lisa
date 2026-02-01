/**
 * Knowledge Command Module
 *
 * Commands for memory, tasks, and storage operations.
 * These are passthrough commands that delegate to skill scripts.
 */

import type {Command} from 'commander';
import path from 'path';
import {getSkillCacheEnv, spawnAndWait} from './cli-utils';
import {ProjectContextService} from '../infrastructure/services/ProjectContextService';

export function registerKnowledgeCommands(program: Command): void {
  // Subcommand: lisa memory
  const memoryCmd = program
    .command('memory')
    .description('Memory operations (load, add, expire, cleanup, link, links)');

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
      if (opts.limit) args.push('--limit', String(parseInt(opts.limit, 10)));
      if (opts.since) args.push('--since', opts.since);
      if (opts.until) args.push('--until', opts.until);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('add <text>')
    .description('Add a memory')
    .option('-g, --group <id>', 'Group ID')
    .option('-t, --tag <tag>', 'Tag for the memory')
    .option('--type <type>', 'Memory type')
    .option('--source <source>', 'Source identifier')
    .option('--lifecycle <tier>', 'Lifecycle tier (permanent, project, session, ephemeral)')
    .option('--ttl <duration>', 'Custom TTL duration (e.g. 30s, 5m, 2h, 7d, 1w)')
    .option('--cache', 'Use cache fallback')
    .action(async (text, opts) => {
      const args = ['add', text];
      if (opts.group) args.push('--group', opts.group);
      if (opts.tag) args.push('--tag', opts.tag);
      if (opts.type) args.push('--type', opts.type);
      if (opts.source) args.push('--source', opts.source);
      if (opts.lifecycle) args.push('--lifecycle', opts.lifecycle);
      if (opts.ttl) args.push('--ttl', opts.ttl);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('expire <uuid>')
    .description('Expire a single memory by UUID')
    .option('-g, --group <id>', 'Group ID')
    .option('--cache', 'Use cache fallback')
    .action(async (uuid: string, opts) => {
      const args = ['expire', '--uuid', uuid];
      if (opts.group) args.push('--group', opts.group);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('cleanup')
    .description('Clean up expired memories based on lifecycle TTL')
    .option('-g, --group <id>', 'Group ID')
    .option('--dry-run', 'Count without expiring')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['cleanup'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.dryRun) args.push('--dry-run');
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('link <sourceUuid> <targetUuid>')
    .description('Create a relationship between two facts')
    .option('-g, --group <id>', 'Group ID')
    .option('--type <relationType>', 'Relation type (supersedes, supports, contradicts, implements, relates_to, refines)', 'relates_to')
    .option('--note <text>', 'Optional annotation')
    .option('--cache', 'Use cache fallback')
    .action(async (sourceUuid: string, targetUuid: string, opts) => {
      const args = ['link', sourceUuid, targetUuid];
      if (opts.group) args.push('--group', opts.group);
      if (opts.type) args.push('--type', opts.type);
      if (opts.note) args.push('--note', opts.note);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('links <uuid>')
    .description('Show relationships for a fact')
    .option('-g, --group <id>', 'Group ID')
    .option('--type <relationType>', 'Filter by relation type')
    .option('--cache', 'Use cache fallback')
    .action(async (uuid: string, opts) => {
      const args = ['links', uuid];
      if (opts.group) args.push('--group', opts.group);
      if (opts.type) args.push('--type', opts.type);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('compact')
    .description('Compact old memories into summaries (e.g. lisa memory compact --before 30d --dry-run)')
    .requiredOption('--before <date>', 'Compact facts older than date (relative: 30d, 3m, 1y; or ISO date)')
    .option('--dry-run', 'Preview without making changes')
    .option('--min-group <n>', 'Minimum facts per group to compact', '3')
    .option('-g, --group <id>', 'Group ID')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['compact'];
      args.push('--before', opts.before);
      if (opts.dryRun) args.push('--dry-run');
      if (opts.minGroup) args.push('--min-group', String(parseInt(opts.minGroup, 10)));
      if (opts.group) args.push('--group', opts.group);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
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
    .option('--all', 'Include tasks from all time (disables default --since today)')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['list'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.limit) args.push('--limit', String(parseInt(opts.limit, 10)));
      if (opts.since) args.push('--since', opts.since);
      if (opts.until) args.push('--until', opts.until);
      if (opts.all) args.push('--all');
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'tasks', 'tasks.js');
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
      const scriptPath = path.join(__dirname, '..', 'skills', 'tasks', 'tasks.js');
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
      const scriptPath = path.join(__dirname, '..', 'skills', 'tasks', 'tasks.js');
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
      const scriptPath = path.join(__dirname, '..', 'skills', 'lisa', 'storage.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('lisa'));
    });

  storageCmd
    .command('switch <mode>')
    .description('Switch storage mode (local, zep-cloud)')
    .option('--cache', 'Use cache fallback')
    .action(async (mode, opts) => {
      const args = ['switch', mode];
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'lisa', 'storage.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('lisa'));
    });

  // Subcommand: lisa context
  const contextCmd = program
    .command('context')
    .description('Project context operations (init, show, update)');

  const contextService = new ProjectContextService();

  contextCmd
    .command('init')
    .description('Initialize project context with auto-detected tech stack')
    .action(async () => {
      const projectRoot = process.cwd();
      const projectName = path.basename(projectRoot);
      const context = await contextService.init(projectRoot, projectName);
      console.log(JSON.stringify({ status: 'ok', action: 'init', context }, null, 2));
    });

  contextCmd
    .command('show')
    .description('Show current project context')
    .action(async () => {
      const projectRoot = process.cwd();
      const context = await contextService.load(projectRoot);
      if (!context) {
        console.log('No project context found. Run `lisa context init` to create one.');
        return;
      }
      console.log(JSON.stringify({ status: 'ok', action: 'show', context }, null, 2));
    });

  contextCmd
    .command('update')
    .description('Update project context')
    .option('--add-stack <item>', 'Add to tech stack')
    .option('--add-decision <text>', 'Add a key decision')
    .option('--add-constraint <text>', 'Add an active constraint')
    .option('--add-convention <text>', 'Add a convention')
    .action(async (opts) => {
      const projectRoot = process.cwd();
      const updates: Record<string, string[]> = {};
      if (opts.addStack) updates.techStack = [opts.addStack];
      if (opts.addDecision) updates.keyDecisions = [opts.addDecision];
      if (opts.addConstraint) updates.activeConstraints = [opts.addConstraint];
      if (opts.addConvention) updates.conventions = [opts.addConvention];

      if (Object.keys(updates).length === 0) {
        console.error('Provide at least one update: --add-stack, --add-decision, --add-constraint, or --add-convention');
        process.exit(1);
      }

      const context = await contextService.update(projectRoot, updates);
      console.log(JSON.stringify({ status: 'ok', action: 'update', context }, null, 2));
    });
}
