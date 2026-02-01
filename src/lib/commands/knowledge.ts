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

  // Subcommand: lisa llm
  const llmCmd = program
    .command('llm')
    .description('LLM provider configuration and testing');

  llmCmd
    .command('config')
    .description('Display or set LLM configuration')
    .option('--provider <provider>', 'Set provider (anthropic, openai, ollama)')
    .option('--model <model>', 'Set model name')
    .option('--endpoint <url>', 'Set custom endpoint URL')
    .option('--api-key <key>', 'Set API key')
    .option('--enable', 'Enable LLM features')
    .option('--disable', 'Disable LLM features')
    .option('--max-tokens <n>', 'Set default max output tokens')
    .option('--temperature <n>', 'Set default temperature (0–2)')
    .option('--reset', 'Reset all LLM configuration to defaults')
    .action(async (opts) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const { createLlmConfigService } = await import('../infrastructure/services/LlmConfigService');
      const store = createPreferenceStore(process.cwd(), console);
      const configSvc = createLlmConfigService(store);

      if (opts.reset) {
        await configSvc.reset();
        console.log(JSON.stringify({ status: 'ok', action: 'reset', message: 'LLM configuration reset to defaults' }, null, 2));
        return;
      }

      let changed = false;
      if (opts.provider) { await configSvc.setProvider(opts.provider); changed = true; }
      if (opts.model) { await configSvc.setModel(opts.model); changed = true; }
      if (opts.endpoint) { await configSvc.setEndpoint(opts.endpoint); changed = true; }
      if (opts.apiKey) { await configSvc.setApiKey(opts.apiKey); changed = true; }
      if (opts.enable) { await configSvc.setEnabled(true); changed = true; }
      if (opts.disable) { await configSvc.setEnabled(false); changed = true; }
      if (opts.maxTokens) {
        await configSvc.setMaxTokens(parseInt(opts.maxTokens, 10));
        changed = true;
      }
      if (opts.temperature) {
        await configSvc.setTemperature(parseFloat(opts.temperature));
        changed = true;
      }

      const config = await configSvc.getConfig();
      const safeConfig = {
        ...config,
        apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}...` : undefined,
      };
      console.log(JSON.stringify({
        status: 'ok',
        action: changed ? 'updated' : 'display',
        config: safeConfig,
      }, null, 2));
    });

  llmCmd
    .command('test [prompt]')
    .description('Send a test prompt to verify LLM connectivity')
    .action(async (prompt?: string) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const { createLlmConfigService } = await import('../infrastructure/services/LlmConfigService');
      const { createLlmService } = await import('../infrastructure/services/LlmService');
      const store = createPreferenceStore(process.cwd(), console);
      const configSvc = createLlmConfigService(store);
      const llmSvc = createLlmService(configSvc);

      const testPrompt = prompt || 'Say hello in one sentence.';
      try {
        const response = await llmSvc.complete(testPrompt);
        console.log(JSON.stringify({
          status: 'ok',
          action: 'test',
          response: response.text,
          provider: response.provider,
          model: response.model,
          usage: response.usage,
        }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({
          status: 'error',
          action: 'test',
          error: error instanceof Error ? error.message : String(error),
        }, null, 2));
        process.exitCode = 1;
      }
    });

  llmCmd
    .command('usage')
    .description('Show LLM token usage and estimated cost')
    .option('--since <date>', 'Show usage since date (ISO format)')
    .action(async (opts) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const { createLlmUsageTracker } = await import('../infrastructure/services/LlmUsageTracker');
      const store = createPreferenceStore(process.cwd(), console);
      const tracker = createLlmUsageTracker(process.cwd(), store);

      const since = opts.since ? new Date(opts.since) : undefined;
      if (since !== undefined && isNaN(since.getTime())) {
        console.log(JSON.stringify({ status: 'error', action: 'usage', error: `Invalid date: ${opts.since}` }, null, 2));
        process.exitCode = 1;
        return;
      }
      const records = await tracker.getUsage(since);
      const totalCost = await tracker.getTotalCost(since);
      const withinBudget = await tracker.isWithinBudget();

      console.log(JSON.stringify({
        status: 'ok',
        action: 'usage',
        records: records.length,
        totalCostUsd: totalCost,
        withinBudget,
        since: since?.toISOString() ?? 'current month',
      }, null, 2));
    });

  llmCmd
    .command('features')
    .description('Show or toggle LLM feature availability')
    .option('--enable <feature>', 'Enable a specific feature')
    .option('--disable <feature>', 'Disable a specific feature')
    .action(async (opts) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const { LLM_FEATURE_VALUES, isValidLlmFeature } = await import('../domain/interfaces/ILlmUsageTracker');
      const store = createPreferenceStore(process.cwd(), console);
      const FEATURES_KEY = 'llm:features';

      if (opts.enable) {
        if (!isValidLlmFeature(opts.enable)) {
          console.log(JSON.stringify({ status: 'error', error: `Invalid feature: ${opts.enable}. Valid: ${LLM_FEATURE_VALUES.join(', ')}` }, null, 2));
          process.exitCode = 1;
          return;
        }
        const current = await store.get(FEATURES_KEY);
        // When no list is set (all enabled by default), materialize the full list before adding
        const features = (current && current.trim() !== '' && current.trim() !== '*')
          ? new Set(current.split(',').map((f: string) => f.trim()).filter((f: string) => f))
          : new Set<string>(LLM_FEATURE_VALUES as readonly string[]);
        features.add(opts.enable);
        await store.set(FEATURES_KEY, Array.from(features).join(','));
        console.log(JSON.stringify({ status: 'ok', action: 'enable', feature: opts.enable, enabledFeatures: Array.from(features) }, null, 2));
        return;
      }

      if (opts.disable) {
        if (!isValidLlmFeature(opts.disable)) {
          console.log(JSON.stringify({ status: 'error', error: `Invalid feature: ${opts.disable}. Valid: ${LLM_FEATURE_VALUES.join(', ')}` }, null, 2));
          process.exitCode = 1;
          return;
        }
        const current = await store.get(FEATURES_KEY);
        if (!current) {
          // All were enabled; now we need to set all minus the disabled one
          const features = new Set(LLM_FEATURE_VALUES as readonly string[]);
          features.delete(opts.disable);
          await store.set(FEATURES_KEY, Array.from(features).join(','));
          console.log(JSON.stringify({ status: 'ok', action: 'disable', feature: opts.disable, enabledFeatures: Array.from(features) }, null, 2));
        } else {
          const features = new Set(current.split(',').map((f: string) => f.trim()).filter((f: string) => f));
          features.delete(opts.disable);
          await store.set(FEATURES_KEY, Array.from(features).join(','));
          console.log(JSON.stringify({ status: 'ok', action: 'disable', feature: opts.disable, enabledFeatures: Array.from(features) }, null, 2));
        }
        return;
      }

      // Display current features
      const current = await store.get(FEATURES_KEY);
      const enabledFeatures = current
        ? current.split(',').map((f: string) => f.trim()).filter((f: string) => f)
        : [...LLM_FEATURE_VALUES];
      console.log(JSON.stringify({
        status: 'ok',
        action: 'display',
        allFeatures: [...LLM_FEATURE_VALUES],
        enabledFeatures,
        allEnabled: current === null || current.trim() === '' || current.trim() === '*',
      }, null, 2));
    });

  // Subcommand: lisa memory summarize
  memoryCmd
    .command('summarize')
    .description('Summarize recent memories using LLM')
    .option('-g, --group <id>', 'Group ID')
    .option('--since <date>', 'Summarize memories since date (ISO format)')
    .option('--topic <topic>', 'Summarize memories about a topic')
    .option('--style <style>', 'Summary style (concise, detailed)', 'concise')
    .option('--max-facts <n>', 'Maximum facts to include', '50')
    .action(async (opts) => {
      const { createPreferenceStore } = await import('../infrastructure/services/PreferenceStore');
      const { createLlmConfigService } = await import('../infrastructure/services/LlmConfigService');
      const { createLlmService } = await import('../infrastructure/services/LlmService');
      const { createLlmUsageTracker } = await import('../infrastructure/services/LlmUsageTracker');
      const { createLlmGuard } = await import('../infrastructure/services/LlmGuard');
      const { createSummarizationService } = await import('../infrastructure/services/SummarizationService');

      let dispose: (() => Promise<void>) | undefined;
      try {
        // Bootstrap minimal services
        const cwd = process.cwd();
        const prefStore = createPreferenceStore(cwd, console);
        const configSvc = createLlmConfigService(prefStore);
        const llmSvc = createLlmService(configSvc);
        const tracker = createLlmUsageTracker(cwd, prefStore);
        const guard = createLlmGuard(llmSvc, tracker, configSvc, prefStore);

        // Memory service requires MCP — import and bootstrap
        const { bootstrapContainer } = await import('../infrastructure/di/bootstrap');
        const bootstrapped = await bootstrapContainer({ projectRoot: cwd });
        dispose = bootstrapped.dispose;
        type IMemorySvc = import('../domain/interfaces/IMemoryService').IMemoryService;
        const memory = await bootstrapped.container.resolve<IMemorySvc>(Symbol.for('Lisa.MemoryService'));

        const summarizer = createSummarizationService(memory, guard);

        const groupId = opts.group || 'default';
        const result = await summarizer.summarize(groupId, {
          since: opts.since ? new Date(opts.since) : undefined,
          topic: opts.topic,
          style: opts.style === 'detailed' ? 'detailed' : 'concise',
          maxFacts: parseInt(opts.maxFacts, 10) || 50,
        });

        console.log(JSON.stringify({
          status: 'ok',
          action: 'summarize',
          ...result,
        }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({
          status: 'error',
          action: 'summarize',
          error: error instanceof Error ? error.message : String(error),
        }, null, 2));
        process.exitCode = 1;
      } finally {
        if (dispose) await dispose();
      }
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
