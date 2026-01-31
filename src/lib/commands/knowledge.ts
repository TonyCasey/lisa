/**
 * Knowledge Command Module
 *
 * Commands for memory, tasks, and storage operations.
 * These are passthrough commands that delegate to skill scripts.
 */

import type {Command} from 'commander';
import path from 'path';
import {getSkillCacheEnv, spawnAndWait} from './cli-utils';

export function registerKnowledgeCommands(program: Command): void {
  // Subcommand: lisa memory
  const memoryCmd = program
    .command('memory')
    .description('Memory operations (load, add, expire, cleanup, verify, curate, conflicts)');

  memoryCmd
    .command('load')
    .description('Load memories from storage')
    .option('-g, --group <id>', 'Group ID')
    .option('-q, --query <query>', 'Search query')
    .option('-l, --limit <n>', 'Max results', '10')
    .option('--since <date>', 'Filter memories created after date (ISO or relative: today, yesterday, 7d, 1w, 1m)')
    .option('--until <date>', 'Filter memories created before date')
    .option('--min-confidence <level>', 'Filter by minimum confidence (verified, high, medium, low, uncertain)')
    .option('--show-metadata', 'Include quality metadata tags in output')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['load'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.query) args.push('--query', opts.query);
      if (opts.limit) args.push('--limit', String(parseInt(opts.limit, 10)));
      if (opts.since) args.push('--since', opts.since);
      if (opts.until) args.push('--until', opts.until);
      if (opts.minConfidence) args.push('--min-confidence', opts.minConfidence);
      if (opts.showMetadata) args.push('--show-metadata');
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
    .option('--confidence <level>', 'Confidence level (verified, high, medium, low, uncertain)')
    .option('--source-type <type>', 'Source type (user-explicit, session-capture, prompt-capture, code-analysis, auto-inferred, external-sync)')
    .option('--cache', 'Use cache fallback')
    .action(async (text, opts) => {
      const args = ['add', text];
      if (opts.group) args.push('--group', opts.group);
      if (opts.tag) args.push('--tag', opts.tag);
      if (opts.type) args.push('--type', opts.type);
      if (opts.source) args.push('--source', opts.source);
      if (opts.lifecycle) args.push('--lifecycle', opts.lifecycle);
      if (opts.ttl) args.push('--ttl', opts.ttl);
      if (opts.confidence) args.push('--confidence', opts.confidence);
      if (opts.sourceType) args.push('--source-type', opts.sourceType);
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
    .command('verify <uuid>')
    .description('Verify a memory, upgrading its confidence to verified')
    .option('-g, --group <id>', 'Group ID')
    .option('--cache', 'Use cache fallback')
    .action(async (uuid: string, opts) => {
      const args = ['verify', '--uuid', uuid];
      if (opts.group) args.push('--group', opts.group);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('curate')
    .description('List memories for curation review, sorted by confidence (lowest first)')
    .option('-g, --group <id>', 'Group ID')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--since <date>', 'Filter memories created after date')
    .option('--min-confidence <level>', 'Filter by minimum confidence (verified, high, medium, low, uncertain)')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['curate'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.limit) args.push('--limit', String(parseInt(opts.limit, 10)));
      if (opts.since) args.push('--since', opts.since);
      if (opts.minConfidence) args.push('--min-confidence', opts.minConfidence);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('conflicts')
    .description('Detect and group potentially conflicting memories')
    .option('-g, --group <id>', 'Group ID')
    .option('--topic <topic>', 'Filter conflicts by topic')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['conflicts'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.topic) args.push('--topic', opts.topic);
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
}
