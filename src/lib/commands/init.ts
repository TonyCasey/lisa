/**
 * Init Command Module
 *
 * Scaffolds Lisa project structure including .lisa, .claude, .opencode directories.
 * Handles storage configuration (local Docker, Zep Cloud, or skip).
 */

import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import type { IServices } from '../interfaces/IServices';
import {
  TEMPLATE_ROOT,
  BUNDLED_OPENCODE_ROOT,
  DEFAULT_ENDPOINT,
  ZEP_CLOUD_ENDPOINT,
  DEFAULT_GROUP,
  type DeploymentMode,
  type CliSupport,
  type IGraphitiConfig,
} from './shared';
import { CronService } from '../infrastructure/cron';

// ============================================================================
// Symlink Utilities
// ============================================================================

/**
 * Create a symlink with Windows fallback.
 * On Windows, tries junction first, then falls back to directory copy.
 */
async function createSymlink(target: string, link: string, cwd?: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  const projectRoot = cwd || process.cwd();

  // Skip if link already exists
  try {
    await fs.lstat(link);
    return;
  } catch {
    // Link doesn't exist, proceed
  }

  const linkDir = path.dirname(link);
  const relativeTarget = path.relative(linkDir, target);

  try {
    if (isWindows) {
      const absoluteTarget = path.resolve(target);
      await fs.symlink(absoluteTarget, link, 'junction');
    } else {
      await fs.symlink(relativeTarget, link, 'dir');
    }
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (isWindows && (error.code === 'EPERM' || error.code === 'ENOENT' || error.code === 'EINVAL')) {
      console.warn(chalk.yellow(`  Symlink failed, copying directory instead: ${path.basename(link)}`));
      await fs.copy(target, link);
      await recordCopyFallback(projectRoot, link, target);
    } else {
      throw err;
    }
  }
}

/**
 * Track directories that were copied instead of linked.
 */
async function recordCopyFallback(projectRoot: string, link: string, target: string): Promise<void> {
  const fallbackFile = path.join(projectRoot, '.lisa', '.copy-fallbacks.json');

  let existing: { copies: Array<{ link: string; target: string; createdAt: string }> } = { copies: [] };
  try {
    existing = await fs.readJson(fallbackFile);
  } catch {
    // File doesn't exist
  }

  const relLink = path.relative(projectRoot, link);
  const relTarget = path.relative(projectRoot, target);

  if (!existing.copies.some(c => c.link === relLink)) {
    existing.copies.push({ link: relLink, target: relTarget, createdAt: new Date().toISOString() });
    await fs.ensureDir(path.dirname(fallbackFile));
    await fs.writeJson(fallbackFile, existing, { spaces: 2 });
  }
}

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Clean up previous Lisa installation before upgrade.
 */
export async function cleanupPreviousInstall(
  skillsDir: string,
  verbose = false
): Promise<{ backedUp: string[]; removed: string[] }> {
  const backedUp: string[] = [];
  const removed: string[] = [];

  if (!await fs.pathExists(skillsDir)) {
    if (verbose) {
      console.log(chalk.gray(`  [cleanup] Skills directory does not exist: ${skillsDir}`));
    }
    return { backedUp, removed };
  }

  if (verbose) {
    console.log(chalk.cyan(`  [cleanup] Scanning skills directory: ${skillsDir}`));
  }

  const skillDirs = await fs.readdir(skillsDir);

  for (const skillName of skillDirs) {
    const skillPath = path.join(skillsDir, skillName);
    const stat = await fs.stat(skillPath);

    if (!stat.isDirectory()) continue;

    // Remove common/ and shared/ directories
    if (skillName === 'common' || skillName === 'shared') {
      if (verbose) {
        console.log(chalk.yellow(`  [cleanup] Removing bundled directory: ${skillName}/`));
      }
      await fs.remove(skillPath);
      removed.push(skillPath);
      continue;
    }

    // Backup existing SKILL.md files
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (await fs.pathExists(skillMdPath)) {
      const backupPath = path.join(skillPath, 'SKILL.md.backup');
      if (verbose) {
        console.log(chalk.gray(`  [cleanup] Backing up: ${skillName}/SKILL.md -> SKILL.md.backup`));
      }
      await fs.copy(skillMdPath, backupPath, { overwrite: true });
      backedUp.push(skillMdPath);
    }

    // Remove scripts/ directory with all JS files
    const scriptsDir = path.join(skillPath, 'scripts');
    if (await fs.pathExists(scriptsDir)) {
      const scriptFiles = await fs.readdir(scriptsDir);
      for (const file of scriptFiles) {
        if (file.endsWith('.js')) {
          const filePath = path.join(scriptsDir, file);
          if (verbose) {
            console.log(chalk.yellow(`  [cleanup] Removing old script: ${skillName}/scripts/${file}`));
          }
          await fs.remove(filePath);
          removed.push(filePath);
        }
      }

      const remainingFiles = await fs.readdir(scriptsDir);
      if (remainingFiles.length === 0) {
        if (verbose) {
          console.log(chalk.gray(`  [cleanup] Removing empty directory: ${skillName}/scripts/`));
        }
        await fs.remove(scriptsDir);
        removed.push(scriptsDir);
      }
    }
  }

  return { backedUp, removed };
}

// ============================================================================
// Interactive Prompts
// ============================================================================

async function promptDeploymentMode(): Promise<DeploymentMode> {
  return await select({
    message: 'How would you like to configure storage?',
    choices: [
      { name: 'Set up later (scaffold project, configure storage later)', value: 'skip' as DeploymentMode },
      { name: 'Local Docker (runs Neo4j + MCP server locally)', value: 'local' as DeploymentMode },
      { name: 'Zep Cloud (managed storage service)', value: 'zep-cloud' as DeploymentMode },
    ],
  });
}

async function promptZepCloudConfig(): Promise<Partial<IGraphitiConfig>> {
  const zepApiKey = await password({
    message: 'Zep API Key:',
    validate: (val) => val.length > 0 || 'API key is required',
  });

  const zepProjectId = await input({
    message: 'Zep Project ID:',
    validate: (val) => val.length > 0 || 'Project ID is required',
  });

  return { zepApiKey, zepProjectId, endpoint: ZEP_CLOUD_ENDPOINT };
}

async function promptGroupId(): Promise<string> {
  const projectName = path.basename(process.cwd());
  return await input({
    message: 'Group ID:',
    default: projectName,
  });
}

async function promptCliSupport(): Promise<CliSupport[]> {
  const choices = await checkbox({
    message: 'Which CLI tools do you want to support?',
    choices: [
      { name: 'Claude Code (Anthropic)', value: 'claude-code' as CliSupport, checked: true },
      { name: 'OpenCode (open source)', value: 'opencode' as CliSupport, checked: true },
    ],
  });

  return choices.length === 0 ? ['claude-code', 'opencode'] : choices;
}

// ============================================================================
// Claude Code Settings
// ============================================================================

const LISA_HOOKS_CONFIG = {
  SessionStart: [{ hooks: [{ type: 'command', command: 'lisa hook session-start' }] }],
  Stop: [{ hooks: [{ type: 'command', command: 'lisa hook session-stop' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'lisa hook user-prompt-submit' }] }],
};

async function mergeClaudeSettings(settingsPath: string, verbose: boolean): Promise<void> {
  let settings: Record<string, unknown> = {};

  if (await fs.pathExists(settingsPath)) {
    try {
      settings = await fs.readJson(settingsPath);
    } catch {
      if (verbose) {
        console.log(chalk.yellow('  Warning: Could not parse existing settings.json, creating new one'));
      }
    }
  }

  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>;
  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [eventName, lisaHookConfigs] of Object.entries(LISA_HOOKS_CONFIG)) {
    const existingEventHooks = mergedHooks[eventName] || [];

    const hasLisaHook = existingEventHooks.some((h: unknown) => {
      if (typeof h === 'object' && h !== null) {
        const hookObj = h as Record<string, unknown>;
        const hooks = hookObj.hooks as Array<{ command?: string }> | undefined;
        return hooks?.some(hh => hh.command?.startsWith('lisa hook'));
      }
      return false;
    });

    if (!hasLisaHook) {
      mergedHooks[eventName] = [...existingEventHooks, ...lisaHookConfigs];
    }
  }

  settings.hooks = mergedHooks;
  await fs.writeJson(settingsPath, settings, { spaces: 2 });
}

async function cleanupOldClaudeFiles(claudeDir: string, verbose: boolean): Promise<void> {
  const hooksDir = path.join(claudeDir, 'hooks');
  const oldHooks = ['session-start.js', 'session-stop.js', 'user-prompt-submit.js', 'session-stop-worker.js'];

  for (const hook of oldHooks) {
    const hookPath = path.join(hooksDir, hook);
    if (await fs.pathExists(hookPath)) {
      await fs.remove(hookPath);
      if (verbose) {
        console.log(chalk.gray(`  Removed old hook: ${hook}`));
      }
    }
  }

  const configPath = path.join(claudeDir, 'config.js');
  if (await fs.pathExists(configPath)) {
    await fs.remove(configPath);
    if (verbose) {
      console.log(chalk.gray('  Removed old config.js (env vars read directly)'));
    }
  }
}

// ============================================================================
// PR Polling Setup
// ============================================================================

interface IPrPollingConfig {
  enabled: boolean;
  notify: boolean;
}

/**
 * Prompt user for PR polling setup.
 */
async function promptPrPolling(): Promise<IPrPollingConfig> {
  const enable = await confirm({
    message: 'Enable PR monitoring? (polls GitHub every 5 minutes for all your PRs)',
    default: true,
  });

  if (!enable) {
    return { enabled: false, notify: false };
  }

  const notify = await confirm({
    message: 'Enable desktop notifications for PR changes?',
    default: true,
  });

  return { enabled: true, notify };
}

/**
 * Set up PR polling cron job.
 */
async function setupPrPolling(config: IPrPollingConfig, verbose: boolean): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const cronService = new CronService();
  const platform = cronService.getPlatform();

  if (platform === 'unsupported') {
    console.log(chalk.yellow('\nPR polling: Unsupported platform for automated setup.'));
    console.log(chalk.cyan(cronService.getManualInstructions({
      name: 'lisa-pr-poll',
      command: 'lisa pr poll',
      intervalMinutes: 5,
      notify: config.notify,
    })));
    return;
  }

  // Check if already installed
  const existingConfig = await cronService.getConfig();
  if (existingConfig?.enabled) {
    if (verbose) {
      console.log(chalk.cyan('\nPR polling already configured, updating...'));
    }
  }

  console.log(chalk.cyan('\nSetting up PR polling...'));

  const result = await cronService.install({
    name: 'lisa-pr-poll',
    command: 'lisa pr poll',
    intervalMinutes: 5,
    notify: config.notify,
  });

  if (result.success) {
    const notifyStr = config.notify ? ' with desktop notifications' : '';
    console.log(chalk.green(`  Installed ${result.platform} job: lisa pr poll${notifyStr}`));
    console.log(chalk.green('  PR monitoring is now active. Use `lisa pr watch <number>` to start tracking PRs.'));
  } else {
    console.log(chalk.yellow(`  Automated setup failed: ${result.error}`));
    if (result.manualInstructions) {
      console.log(chalk.cyan('\nManual setup instructions:'));
      console.log(result.manualInstructions);
    }
  }
}

// ============================================================================
// Init Command Options
// ============================================================================

export interface IInitOptions {
  endpoint?: string;
  group?: string;
  force?: boolean;
  cwd: string;
  includeDocker?: boolean;
  mode?: DeploymentMode;
  zepApiKey?: string;
  zepProjectId?: string;
  yes?: boolean;
  isolated?: boolean;
  cliSupport?: CliSupport[];
  verbose?: boolean;
  /** Skip PR polling setup prompt */
  skipPrPolling?: boolean;
  /** Enable PR polling (for -y mode) */
  enablePrPolling?: boolean;
  /** Enable desktop notifications for PR polling */
  prPollingNotify?: boolean;
}

// ============================================================================
// Init Command Implementation
// ============================================================================

export async function initCommand(opts: IInitOptions, services: IServices): Promise<void> {
  const force = Boolean(opts.force);
  const verbose = opts.verbose !== false;
  const cwd = opts.cwd;
  let config: IGraphitiConfig;
  let cliSupport: CliSupport[];

  const hasExplicitMode = opts.mode !== undefined;
  const skipPrompts = opts.yes || hasExplicitMode;

  if (skipPrompts) {
    const mode = opts.mode || 'local';
    config = {
      mode,
      endpoint: opts.endpoint || (mode === 'zep-cloud' ? ZEP_CLOUD_ENDPOINT : DEFAULT_ENDPOINT),
      groupId: opts.group || process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP,
      zepApiKey: opts.zepApiKey,
      zepProjectId: opts.zepProjectId,
    };
    cliSupport = opts.cliSupport || ['claude-code', 'opencode'];
  } else {
    const mode = await promptDeploymentMode();
    let modeConfig: Partial<IGraphitiConfig>;

    if (mode === 'zep-cloud') {
      modeConfig = await promptZepCloudConfig();
    } else {
      modeConfig = { endpoint: DEFAULT_ENDPOINT };
    }

    const groupId = await promptGroupId();
    cliSupport = await promptCliSupport();

    config = {
      mode,
      endpoint: modeConfig.endpoint || DEFAULT_ENDPOINT,
      groupId,
      ...modeConfig,
    };
  }

  const includeDocker = opts.includeDocker !== false && config.mode !== 'zep-cloud' && config.mode !== 'skip';
  const supportClaudeCode = cliSupport.includes('claude-code');
  const supportOpenCode = cliSupport.includes('opencode');

  const replacements = {
    GRAPHITI_ENDPOINT: config.endpoint,
    GRAPHITI_GROUP: config.groupId,
    GRAPHITI_GROUP_ID: config.groupId,
    PROJECT_NAME: config.groupId,
  };

  const lisaDir = path.join(cwd, '.lisa');
  const skillsDir = path.join(lisaDir, 'skills');
  const rulesDir = path.join(lisaDir, 'rules');
  const claudeDir = path.join(cwd, '.claude');
  const composeDest = path.join(cwd, 'docker-compose.graphiti.yml');

  const copies: Array<Promise<{ skipped: boolean } | void>> = [];

  // Create .env from template
  const envDest = path.join(lisaDir, '.env');
  if (!await fs.pathExists(envDest)) {
    await fs.ensureDir(lisaDir);
    copies.push(services.templateCopier.copy('.lisa/.env.template', envDest, replacements, false));
  }

  // Clean up previous installation
  if (await fs.pathExists(skillsDir)) {
    if (verbose) console.log(chalk.cyan('\nUpgrade cleanup:'));
    const cleanup = await cleanupPreviousInstall(skillsDir, verbose);
    if (cleanup.backedUp.length > 0) {
      console.log(chalk.cyan(`  Backed up ${cleanup.backedUp.length} existing SKILL.md file(s)`));
    }
    if (cleanup.removed.length > 0) {
      console.log(chalk.cyan(`  Removed ${cleanup.removed.length} old script file(s)/director(ies)`));
    }
  }

  // Skills scaffolding
  const skillsSrc = path.join(TEMPLATE_ROOT, '.lisa', 'skills');
  await fs.ensureDir(skillsDir);
  copies.push(fs.copy(skillsSrc, skillsDir, {
    overwrite: true,
    filter: (src: string) => {
      const basename = path.basename(src);
      const relativePath = path.relative(skillsSrc, src);

      if (relativePath === '') return true;
      if (relativePath.includes('shared') || relativePath.includes('common')) return false;
      if (relativePath.includes('scripts')) return false;
      if (basename === 'SKILL.md' || basename === 'SKILL.local.md') return true;
      if (basename === 'cache' || basename === '.gitkeep') return true;

      return fs.statSync(src).isDirectory();
    }
  }));

  // Rules scaffolding
  copies.push(services.templateCopier.copy('.lisa/rules/shared/clean-architecture.md', path.join(rulesDir, 'shared', 'clean-architecture.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/code-quality-rules.md', path.join(rulesDir, 'shared', 'code-quality-rules.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/testing-principles.md', path.join(rulesDir, 'shared', 'testing-principles.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/coding-standards.md', path.join(rulesDir, 'typescript', 'coding-standards.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/testing.md', path.join(rulesDir, 'typescript', 'testing.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/typescript-config-guide.md', path.join(rulesDir, 'typescript', 'typescript-config-guide.md'), replacements, force));

  // Claude Code scaffolding
  if (supportClaudeCode) {
    await fs.ensureDir(claudeDir);

    const claudeSkillsDir = path.join(claudeDir, 'skills');
    try {
      const skillsStat = await fs.lstat(claudeSkillsDir);
      if (skillsStat.isSymbolicLink()) {
        if (verbose) console.log(chalk.cyan('\nMigrating .claude/skills from symlink to directory:'));
        await fs.remove(claudeSkillsDir);
        console.log(chalk.cyan('  Removed old symlink .claude/skills'));
      }
    } catch { /* Doesn't exist */ }

    await fs.ensureDir(claudeSkillsDir);

    const lisaSkills = ['memory', 'tasks', 'lisa', 'git', 'jira', 'init-review', 'prompt', 'github'];
    for (const skill of lisaSkills) {
      const skillLink = path.join(claudeSkillsDir, skill);
      const skillTarget = path.join(skillsDir, skill);

      if (await fs.pathExists(skillTarget)) {
        try { await fs.lstat(skillLink); await fs.remove(skillLink); } catch { /* Doesn't exist */ }
        await createSymlink(skillTarget, skillLink, cwd);
      }
    }

    const claudeRulesDir = path.join(claudeDir, 'rules');
    const claudeRulesLisaLink = path.join(claudeRulesDir, 'lisa');

    try {
      const rulesStat = await fs.lstat(claudeRulesDir);
      if (rulesStat.isSymbolicLink()) {
        if (verbose) console.log(chalk.cyan('\nMigrating .claude/rules from symlink to directory:'));
        await fs.remove(claudeRulesDir);
        console.log(chalk.cyan('  Removed old symlink .claude/rules'));
      }
    } catch { /* Doesn't exist */ }

    await fs.ensureDir(claudeRulesDir);
    try { await fs.lstat(claudeRulesLisaLink); await fs.remove(claudeRulesLisaLink); } catch { /* Doesn't exist */ }
    await createSymlink(rulesDir, claudeRulesLisaLink, cwd);

    const settingsPath = path.join(claudeDir, 'settings.json');
    await mergeClaudeSettings(settingsPath, verbose);
    await cleanupOldClaudeFiles(claudeDir, verbose);

    if (verbose) {
      console.log(chalk.green(`  Created .claude/skills/{${lisaSkills.join(',')}} -> .lisa/skills/*`));
      console.log(chalk.green('  Created .claude/rules/lisa/ -> .lisa/rules'));
      console.log(chalk.green('  Merged hook configuration into .claude/settings.json'));
    }
  }

  // OpenCode scaffolding
  if (supportOpenCode) {
    const opencodeDir = path.join(cwd, '.opencode');
    const pluginDir = path.join(opencodeDir, 'plugin');
    await fs.ensureDir(pluginDir);

    const pluginSrc = path.join(BUNDLED_OPENCODE_ROOT, 'lisa.js');
    const pluginDest = path.join(pluginDir, 'lisa.js');
    if (await fs.pathExists(pluginSrc)) {
      copies.push(fs.copy(pluginSrc, pluginDest, { overwrite: force }));
    }

    const opencodeSkillsDir = path.join(opencodeDir, 'skills');
    try {
      const skillsStat = await fs.lstat(opencodeSkillsDir);
      if (skillsStat.isSymbolicLink()) {
        await fs.remove(opencodeSkillsDir);
        if (verbose) console.log(chalk.cyan('  Removed old symlink .opencode/skills'));
      }
    } catch { /* Doesn't exist */ }

    await fs.ensureDir(opencodeSkillsDir);

    const lisaSkills = ['memory', 'tasks', 'lisa', 'git', 'jira', 'init-review', 'prompt'];
    for (const skill of lisaSkills) {
      const skillLink = path.join(opencodeSkillsDir, skill);
      const skillTarget = path.join(skillsDir, skill);

      if (await fs.pathExists(skillTarget)) {
        try { await fs.lstat(skillLink); await fs.remove(skillLink); } catch { /* Doesn't exist */ }
        await createSymlink(skillTarget, skillLink, cwd);
      }
    }

    if (verbose) {
      console.log(chalk.green(`  Created .opencode/skills/{${lisaSkills.join(',')}} -> .lisa/skills/*`));
    }
  }

  if (includeDocker) {
    copies.push(services.templateCopier.copy('.lisa/docker/docker-compose.graphiti.yml', composeDest, replacements, force));
  }

  await Promise.all(copies);

  // Output summary
  const scaffoldedDirs = ['.lisa'];
  if (supportClaudeCode) scaffoldedDirs.push('.claude');
  if (supportOpenCode) scaffoldedDirs.push('.opencode');
  if (includeDocker) scaffoldedDirs.push('Docker assets');

  console.log(chalk.green(`Scaffolded ${scaffoldedDirs.join(', ')} into ${cwd}`));
  console.log(`Mode: ${config.mode}`);
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Group ID: ${config.groupId}`);
  console.log(`CLI Support: ${cliSupport.join(', ')}`);

  if (config.mode === 'skip') {
    console.log('');
    console.log(chalk.cyan('To configure storage later:'));
    console.log(chalk.cyan('  1. Read .lisa/docs/STORAGE_SETUP.md'));
    console.log(chalk.cyan('  2. Edit .lisa/.env with your configuration'));
    console.log(chalk.cyan('  3. Start a new terminal session'));
    console.log(chalk.cyan('  4. Run `lisa doctor` to verify connection'));
  }

  if (opts.isolated) {
    const libDir = path.join(claudeDir, 'lib');
    await fs.ensureDir(libDir);

    const libPackageJson = {
      name: 'claude-lib',
      version: '1.0.0',
      private: true,
      description: 'Lisa support files for Claude Code',
    };

    const libPackagePath = path.join(libDir, 'package.json');
    if (!await fs.pathExists(libPackagePath) || force) {
      await fs.writeJson(libPackagePath, libPackageJson, { spaces: 2 });
      console.log(chalk.green('Created .claude/lib/package.json'));
    }

    const gitignorePath = path.join(cwd, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      let gitignore = await fs.readFile(gitignorePath, 'utf8');
      if (!gitignore.includes('.claude/lib/node_modules')) {
        gitignore += '\n# Lisa support files\n.claude/lib/node_modules/\n';
        await fs.writeFile(gitignorePath, gitignore);
        console.log(chalk.green('Added .claude/lib/node_modules to .gitignore'));
      }
    }

    console.log('');
    console.log(chalk.cyan('Isolated mode: Lisa installed to .claude/lib/'));
    console.log(chalk.cyan('Your project root stays clean (no package.json or node_modules).'));
  }

  // PR Polling setup (global, not per-project)
  if (!opts.skipPrPolling) {
    let prPollingConfig: IPrPollingConfig;

    if (skipPrompts) {
      // Non-interactive mode: use enablePrPolling flag (default: false to avoid surprises)
      prPollingConfig = {
        enabled: opts.enablePrPolling ?? false,
        notify: opts.prPollingNotify ?? true,
      };
    } else {
      // Interactive mode: prompt user
      prPollingConfig = await promptPrPolling();
    }

    await setupPrPolling(prPollingConfig, verbose);
  }
}
