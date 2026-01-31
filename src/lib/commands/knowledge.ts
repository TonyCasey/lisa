/**
 * Knowledge Command Module
 *
 * Commands for memory, tasks, storage, and context operations.
 * These are passthrough commands that delegate to skill scripts.
 */

import type {Command} from 'commander';
import path from 'path';
import fs from 'fs';
import {getSkillCacheEnv, spawnAndWait} from './cli-utils';
import { TASK_TYPE_VALUES, isValidTaskType } from '../domain/interfaces/types/ITaskType';

export function registerKnowledgeCommands(program: Command): void {
  // Subcommand: lisa memory
  const memoryCmd = program
    .command('memory')
    .description('Memory operations (load, add, expire, cleanup)');

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
    .description('Context mode operations (get-mode, set-mode)');

  contextCmd
    .command('get-mode')
    .description('Show current context mode')
    .action(() => {
      const mode = readContextMode(process.cwd());
      if (mode) {
        console.log(`Context mode: ${mode}`);
      } else {
        console.log('Context mode: auto (default)');
      }
    });

  contextCmd
    .command('set-mode <mode>')
    .description(`Set context mode (${TASK_TYPE_VALUES.join(', ')}, auto)`)
    .action((mode: string) => {
      const normalised = mode.toLowerCase().trim();
      if (normalised === 'auto') {
        clearContextMode(process.cwd());
        console.log('Context mode reset to auto (default).');
        return;
      }
      if (!isValidTaskType(normalised)) {
        console.error(`Invalid mode: ${mode}`);
        console.error(`Valid modes: ${TASK_TYPE_VALUES.join(', ')}, auto`);
        process.exitCode = 1;
        return;
      }
      writeContextMode(process.cwd(), normalised);
      console.log(`Context mode set to: ${normalised}`);
    });
}

/**
 * Read stored context mode from .lisa/.context-mode file.
 */
export function readContextMode(projectRoot: string): string | null {
  try {
    const modePath = path.join(projectRoot, '.lisa', '.context-mode');
    const mode = fs.readFileSync(modePath, 'utf-8').trim();
    if (mode && mode !== 'auto' && isValidTaskType(mode)) {
      return mode;
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

/**
 * Write context mode to .lisa/.context-mode file.
 */
export function writeContextMode(projectRoot: string, mode: string): void {
  const lisaDir = path.join(projectRoot, '.lisa');
  if (!fs.existsSync(lisaDir)) {
    fs.mkdirSync(lisaDir, { recursive: true });
  }
  fs.writeFileSync(path.join(lisaDir, '.context-mode'), mode + '\n', 'utf-8');
}

/**
 * Clear context mode (remove .lisa/.context-mode file).
 */
export function clearContextMode(projectRoot: string): void {
  try {
    fs.unlinkSync(path.join(projectRoot, '.lisa', '.context-mode'));
  } catch {
    // File doesn't exist - already cleared
  }
}
