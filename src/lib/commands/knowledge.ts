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
    .description('Memory operations (load, add, expire, cleanup, conflicts, dedupe, curate, consolidate)');

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
    .command('conflicts')
    .description('Find groups of potentially conflicting facts')
    .option('-g, --group <id>', 'Group ID')
    .option('--topic <tag>', 'Filter by topic tag (e.g. type:decision)')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['conflicts'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.topic) args.push('--topic', opts.topic);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('dedupe')
    .description('Detect duplicate facts (detection only, no mutations)')
    .option('-g, --group <id>', 'Group ID')
    .option('--min-similarity <n>', 'Minimum similarity threshold (default: 0.6)')
    .option('-l, --limit <n>', 'Max duplicate groups to display (default: 10)')
    .option('--since <date>', 'Only scan facts created after date')
    .option('--cache', 'Use cache fallback')
    .action(async (opts) => {
      const args = ['dedupe'];
      if (opts.group) args.push('--group', opts.group);
      if (opts.minSimilarity) args.push('--min-similarity', opts.minSimilarity);
      if (opts.limit) args.push('--limit', String(parseInt(opts.limit, 10)));
      if (opts.since) args.push('--since', opts.since);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('curate <uuid>')
    .description('Mark a fact with a curation status (authoritative, draft, deprecated, needs-review)')
    .option('-g, --group <id>', 'Group ID')
    .option('--mark <mark>', 'Curation mark (authoritative, draft, deprecated, needs-review)')
    .option('--cache', 'Use cache fallback')
    .action(async (uuid: string, opts) => {
      const args = ['curate', '--uuid', uuid];
      if (opts.group) args.push('--group', opts.group);
      if (opts.mark) args.push('--mark', opts.mark);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  memoryCmd
    .command('consolidate')
    .description('Consolidate duplicate facts (merge, archive-duplicates, or keep-all)')
    .argument('<uuids...>', 'Two or more fact UUIDs to consolidate')
    .option('-g, --group <id>', 'Group ID')
    .option('--action <action>', 'Consolidation action (merge, archive-duplicates, keep-all)', 'archive-duplicates')
    .option('--retain <uuid>', 'UUID of the fact to keep (for archive-duplicates)')
    .option('--text <text>', 'Merged text for the new fact (for merge action)')
    .option('--cache', 'Use cache fallback')
    .action(async (uuids: string[], opts) => {
      const args = ['consolidate', ...uuids];
      if (opts.group) args.push('--group', opts.group);
      if (opts.action) args.push('--action', opts.action);
      if (opts.retain) args.push('--retain', opts.retain);
      if (opts.text) args.push('--text', opts.text);
      if (opts.cache) args.push('--cache');
      const scriptPath = path.join(__dirname, '..', 'skills', 'memory', 'memory.js');
      await spawnAndWait(scriptPath, args, getSkillCacheEnv('memory'));
    });

  // Subcommand: lisa pref
  const prefCmd = program
    .command('pref')
    .description('Preference key-value store (get, set, delete, list)');

  prefCmd
    .command('get <key>')
    .description('Get a preference value')
    .action(async (key: string) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const store = createPreferenceStore(process.cwd(), console);
      const value = await store.get(key);
      if (value === null) {
        console.log(JSON.stringify({ status: 'ok', action: 'get', key, found: false }, null, 2));
      } else {
        console.log(JSON.stringify({ status: 'ok', action: 'get', key, value, found: true }, null, 2));
      }
    });

  prefCmd
    .command('set <key> <value>')
    .description('Set a preference value')
    .action(async (key: string, value: string) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const store = createPreferenceStore(process.cwd(), console);
      await store.set(key, value);
      console.log(JSON.stringify({ status: 'ok', action: 'set', key, value }, null, 2));
    });

  prefCmd
    .command('delete <key>')
    .description('Delete a preference')
    .action(async (key: string) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const store = createPreferenceStore(process.cwd(), console);
      const deleted = await store.delete(key);
      console.log(JSON.stringify({ status: 'ok', action: 'delete', key, deleted }, null, 2));
    });

  prefCmd
    .command('list')
    .description('List all preferences')
    .action(async () => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const store = createPreferenceStore(process.cwd(), console);
      const preferences = await store.list();
      console.log(JSON.stringify({ status: 'ok', action: 'list', preferences, count: preferences.length }, null, 2));
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
