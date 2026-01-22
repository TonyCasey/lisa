#!/usr/bin/env node
import {Command} from 'commander';
import {spawn} from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import {checkbox, input, password, select} from '@inquirer/prompts';
import {createDefaultServices, IServices} from './services';
import {IScanOptions, runScan} from './scanner';
import {createLogger, withCorrelation} from './infrastructure';
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

// Templates are copied into dist/project by postbuild; resolve relative to compiled file.
const TEMPLATE_ROOT = path.join(__dirname, '..', 'project');
// Bundled OpenCode plugin is in dist/opencode
const BUNDLED_OPENCODE_ROOT = path.join(__dirname, '..', 'opencode');

// Read version from package.json (works in both dev and dist)
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
const VERSION = fs.existsSync(PACKAGE_JSON_PATH) 
  ? (fs.readJsonSync(PACKAGE_JSON_PATH) as { version: string }).version 
  : '0.0.0';

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
const ZEP_CLOUD_ENDPOINT = 'https://api.getzep.com/mcp/';

/**
 * Get project name from package.json or directory name.
 * Used as the default group ID for memory storage.
 */
function getProjectName(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = fs.readJsonSync(pkgPath);
      if (pkg.name) {
        // Remove scope prefix if present (e.g., @tonycasey/lisa -> lisa)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch {
    // Ignore errors reading package.json
  }
  // Fall back to directory name
  return path.basename(process.cwd());
}

const DEFAULT_GROUP = getProjectName();

// Create CLI logger (console disabled by default to avoid interfering with CLI output)
const cliLogger = createLogger({ 
  enableConsole: process.env.LOG_CONSOLE === 'true',
  enableFile: process.env.LOG_FILE !== 'false',
});

// Deployment mode types
type DeploymentMode = 'local' | 'zep-cloud' | 'skip';

// CLI support types
type CliSupport = 'claude-code' | 'opencode';

interface IGraphitiConfig {
  mode: DeploymentMode;
  endpoint: string;
  groupId: string;
  // Zep Cloud specific
  zepApiKey?: string;
  zepProjectId?: string;
}

/**
 * Create a symlink with Windows fallback.
 * On Windows, tries junction first, then falls back to directory copy.
 * Records copy fallbacks for later sync.
 */
async function createSymlink(target: string, link: string, cwd?: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  const projectRoot = cwd || process.cwd();
  
  // Skip if link already exists (use lstat to detect symlinks even if target doesn't exist)
  try {
    await fs.lstat(link);
    return; // Link exists (symlink, junction, or regular file/dir)
  } catch {
    // Link doesn't exist, proceed with creation
  }
  
  // Calculate relative path from link to target (for Unix symlinks)
  const linkDir = path.dirname(link);
  const relativeTarget = path.relative(linkDir, target);
  
  try {
    if (isWindows) {
      // Windows junctions require absolute paths
      const absoluteTarget = path.resolve(target);
      // Try junction first (doesn't require admin rights)
      await fs.symlink(absoluteTarget, link, 'junction');
    } else {
      // Unix: standard symlink with relative path
      await fs.symlink(relativeTarget, link, 'dir');
    }
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (isWindows && (error.code === 'EPERM' || error.code === 'ENOENT' || error.code === 'EINVAL')) {
      // Junction failed, fall back to copy
      console.warn(chalk.yellow(`  Symlink failed, copying directory instead: ${path.basename(link)}`));
      await fs.copy(target, link);
      
      // Record that we used copy (for future sync)
      await recordCopyFallback(projectRoot, link, target);
    } else {
      throw err;
    }
  }
}

/**
 * Track directories that were copied instead of linked.
 * Used by `lisa sync` to keep copies up to date.
 */
async function recordCopyFallback(projectRoot: string, link: string, target: string): Promise<void> {
  const fallbackFile = path.join(projectRoot, '.lisa', '.copy-fallbacks.json');
  
  let existing: { copies: Array<{ link: string; target: string; createdAt: string }> } = { copies: [] };
  try {
    existing = await fs.readJson(fallbackFile);
  } catch {
    // File doesn't exist yet, use default
  }
  
  // Store relative paths
  const relLink = path.relative(projectRoot, link);
  const relTarget = path.relative(projectRoot, target);
  
  // Check if already recorded
  if (!existing.copies.some(c => c.link === relLink)) {
    existing.copies.push({ link: relLink, target: relTarget, createdAt: new Date().toISOString() });
    await fs.ensureDir(path.dirname(fallbackFile));
    await fs.writeJson(fallbackFile, existing, { spaces: 2 });
  }
}

/**
 * Clean up previous Lisa installation before upgrade.
 * - Removes scripts/** JS files from skill directories (old format)
 * - Backs up existing SKILL.md files to SKILL.md.backup
 * - Removes common/ and shared/ directories (now bundled)
 * 
 * @param skillsDir - Path to skills directory
 * @param verbose - If true, logs detailed information about each operation
 */
async function cleanupPreviousInstall(skillsDir: string, verbose = false): Promise<{ backedUp: string[]; removed: string[] }> {
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

    // Remove common/ and shared/ directories (now bundled into CLI)
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
      // Find and remove all .js files in scripts/
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
      
      // Remove scripts/ directory if empty
      const remainingFiles = await fs.readdir(scriptsDir);
      if (remainingFiles.length === 0) {
        if (verbose) {
          console.log(chalk.gray(`  [cleanup] Removing empty directory: ${skillName}/scripts/`));
        }
        await fs.remove(scriptsDir);
        removed.push(scriptsDir);
      } else if (verbose) {
        console.log(chalk.gray(`  [cleanup] Keeping ${skillName}/scripts/ (contains ${remainingFiles.length} non-JS files)`));
      }
    }
  }

  return { backedUp, removed };
}

// Interactive prompt functions
async function promptDeploymentMode(): Promise<DeploymentMode> {
  return await select({
    message: 'How would you like to configure storage?',
    choices: [
      {
        name: 'Set up later (scaffold project, configure storage later)',
        value: 'skip' as DeploymentMode,
      },
      {
        name: 'Local Docker (runs Neo4j + MCP server locally)',
        value: 'local' as DeploymentMode,
      },
      {
        name: 'Zep Cloud (managed storage service)',
        value: 'zep-cloud' as DeploymentMode,
      },
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

  return {
    zepApiKey,
    zepProjectId,
    endpoint: ZEP_CLOUD_ENDPOINT,
  };
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
      {
        name: 'Claude Code (Anthropic)',
        value: 'claude-code' as CliSupport,
        checked: true,
      },
      {
        name: 'OpenCode (open source)',
        value: 'opencode' as CliSupport,
        checked: true,
      },
    ],
  });

  // Default to both if none selected
  if (choices.length === 0) {
    return ['claude-code', 'opencode'];
  }

  return choices;
}

/**
 * Lisa hook configuration for Claude Code settings.json
 */
const LISA_HOOKS_CONFIG = {
  SessionStart: [{
    hooks: [{ type: 'command', command: 'lisa hook session-start' }],
  }],
  Stop: [{
    hooks: [{ type: 'command', command: 'lisa hook session-stop' }],
  }],
  UserPromptSubmit: [{
    hooks: [{ type: 'command', command: 'lisa hook user-prompt-submit' }],
  }],
};

/**
 * Merge Lisa hooks into .claude/settings.json.
 * Preserves existing user settings and hooks.
 */
async function mergeClaudeSettings(settingsPath: string, verbose: boolean): Promise<void> {
  let settings: Record<string, unknown> = {};

  // Load existing settings if present
  if (await fs.pathExists(settingsPath)) {
    try {
      settings = await fs.readJson(settingsPath);
    } catch {
      // Invalid JSON, start fresh but warn user
      if (verbose) {
        console.log(chalk.yellow('  Warning: Could not parse existing settings.json, creating new one'));
      }
    }
  }

  // Merge hooks - Lisa hooks are added to existing hooks (not replaced)
  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>;
  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };

  for (const [eventName, lisaHookConfigs] of Object.entries(LISA_HOOKS_CONFIG)) {
    const existingEventHooks = mergedHooks[eventName] || [];
    
    // Check if Lisa hooks are already present (avoid duplicates)
    const hasLisaHook = existingEventHooks.some((h: unknown) => {
      if (typeof h === 'object' && h !== null) {
        const hookObj = h as Record<string, unknown>;
        const hooks = hookObj.hooks as Array<{ command?: string }> | undefined;
        return hooks?.some(hh => hh.command?.startsWith('lisa hook'));
      }
      return false;
    });

    if (!hasLisaHook) {
      // Add Lisa hooks
      mergedHooks[eventName] = [...existingEventHooks, ...lisaHookConfigs];
    }
  }

  settings.hooks = mergedHooks;

  // Write merged settings
  await fs.writeJson(settingsPath, settings, { spaces: 2 });
}

/**
 * Clean up old Claude Code files that are no longer needed.
 * - Old bundled hooks (now via CLI commands)
 * - Old config.js (now read from env vars)
 */
async function cleanupOldClaudeFiles(claudeDir: string, verbose: boolean): Promise<void> {
  // Remove old bundled hooks
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

  // Remove hooks directory if empty
  try {
    const hooksContents = await fs.readdir(hooksDir);
    // Filter out hidden files and utils directory (keep user hooks)
    const userHooks = hooksContents.filter(f => !f.startsWith('.') && f !== 'utils');
    if (userHooks.length === 0) {
      // Only remove if there are no user hooks
      // But keep the directory if user has custom hooks
    }
  } catch {
    // Hooks directory doesn't exist, that's fine
  }

  // Remove old config.js (no longer needed - env vars read directly)
  const configPath = path.join(claudeDir, 'config.js');
  if (await fs.pathExists(configPath)) {
    await fs.remove(configPath);
    if (verbose) {
      console.log(chalk.gray('  Removed old config.js (env vars read directly)'));
    }
  }
}

async function initCommand(opts: {
  endpoint?: string;
  group?: string;
  force?: boolean;
  cwd: string;
  includeDocker?: boolean;
  mode?: DeploymentMode;
  zepApiKey?: string;
  zepProjectId?: string;
  yes?: boolean; // Skip prompts, use defaults
  isolated?: boolean; // Install to .claude/lib for non-npm projects
  cliSupport?: CliSupport[]; // Which CLIs to support
  verbose?: boolean; // Show detailed logging (default: true)
}, services: IServices) {
  const force = Boolean(opts.force);
  const verbose = opts.verbose !== false; // Default to true
  const cwd = opts.cwd;
  let config: IGraphitiConfig;
  let cliSupport: CliSupport[];

  // Determine if we need interactive prompts
  const hasExplicitMode = opts.mode !== undefined;
  const skipPrompts = opts.yes || hasExplicitMode;

  if (skipPrompts) {
    // Non-interactive mode - use provided options or defaults
    const mode = opts.mode || 'local';
    config = {
      mode,
      endpoint: opts.endpoint || (mode === 'zep-cloud' ? ZEP_CLOUD_ENDPOINT : DEFAULT_ENDPOINT),
      groupId: opts.group || process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP,
      zepApiKey: opts.zepApiKey,
      zepProjectId: opts.zepProjectId,
    };
    // Default to both CLIs if not specified
    cliSupport = opts.cliSupport || ['claude-code', 'opencode'];
  } else {
    // Interactive mode - prompt user
    const mode = await promptDeploymentMode();
    let modeConfig: Partial<IGraphitiConfig>;

    if (mode === 'zep-cloud') {
      modeConfig = await promptZepCloudConfig();
    } else {
      modeConfig = { endpoint: DEFAULT_ENDPOINT };
    }

    const groupId = await promptGroupId();

    // Prompt for CLI support
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

  // Create .env from template on first install only (preserve user customizations)
  const envDest = path.join(lisaDir, '.env');
  if (!await fs.pathExists(envDest)) {
    await fs.ensureDir(lisaDir);
    copies.push(
      services.templateCopier.copy(
        '.lisa/.env.template',
        envDest,
        replacements,
        false  // Never force overwrite - preserves user customizations
      )
    );
  }

  // Clean up previous installation if upgrading
  // This removes old scripts/** JS files and backs up existing SKILL.md files
  if (await fs.pathExists(skillsDir)) {
    if (verbose) {
      console.log(chalk.cyan('\nUpgrade cleanup:'));
    }
    const cleanup = await cleanupPreviousInstall(skillsDir, verbose);
    if (cleanup.backedUp.length > 0) {
      console.log(chalk.cyan(`  Backed up ${cleanup.backedUp.length} existing SKILL.md file(s)`));
    }
    if (cleanup.removed.length > 0) {
      console.log(chalk.cyan(`  Removed ${cleanup.removed.length} old script file(s)/director(ies)`));
    }
    if (verbose && cleanup.backedUp.length === 0 && cleanup.removed.length === 0) {
      console.log(chalk.gray('  No cleanup needed (fresh install or already upgraded)'));
    }
  }

  // Skill scaffolding (model-neutral) - copy only SKILL.md files and cache dirs
  // Scripts are accessed via subcommands (lisa memory, lisa tasks, etc.)
  // SKILL.md files are always overwritten (we back them up above), other files respect force flag
  const skillsSrc = path.join(TEMPLATE_ROOT, '.lisa', 'skills');
  await fs.ensureDir(skillsDir);
  copies.push(fs.copy(skillsSrc, skillsDir, { 
    overwrite: true,  // Always overwrite SKILL.md files (they're backed up above)
    filter: (src: string) => {
      const basename = path.basename(src);
      const relativePath = path.relative(skillsSrc, src);
      
      // Always include the root skills directory
      if (relativePath === '') return true;
      
      // Include skill directories (memory, tasks, jira, git, lisa, prompt, init-review)
      // but exclude shared/, common/, scripts/
      if (relativePath.includes('shared') || relativePath.includes('common')) return false;
      if (relativePath.includes('scripts')) return false;
      
      // Include SKILL.md files and cache directories
      if (basename === 'SKILL.md' || basename === 'SKILL.local.md') return true;
      if (basename === 'cache' || basename === '.gitkeep') return true;
      
      // Include directories that might contain the above
      return fs.statSync(src).isDirectory();
      

    }
  }));

  // Rules scaffolding (shared)
  copies.push(services.templateCopier.copy('.lisa/rules/shared/clean-architecture.md', path.join(rulesDir, 'shared', 'clean-architecture.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/code-quality-rules.md', path.join(rulesDir, 'shared', 'code-quality-rules.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/testing-principles.md', path.join(rulesDir, 'shared', 'testing-principles.md'), replacements, force));

  // Rules scaffolding (typescript)
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/coding-standards.md', path.join(rulesDir, 'typescript', 'coding-standards.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/testing.md', path.join(rulesDir, 'typescript', 'testing.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/typescript-config-guide.md', path.join(rulesDir, 'typescript', 'typescript-config-guide.md'), replacements, force));

  // Claude Code scaffolding - only if Claude Code is selected
  // Uses subdirectory symlinks to avoid destroying user's existing files
  if (supportClaudeCode) {
    await fs.ensureDir(claudeDir);
    
    // Create .claude/skills/ directory (preserve user content)
    const claudeSkillsDir = path.join(claudeDir, 'skills');
    const claudeSkillsLisaLink = path.join(claudeSkillsDir, 'lisa');
    
    // Handle migration from old whole-folder symlink
    try {
      const skillsStat = await fs.lstat(claudeSkillsDir);
      if (skillsStat.isSymbolicLink()) {
        // Old symlink - remove it and create directory
        if (verbose) {
          console.log(chalk.cyan('\nMigrating .claude/skills from symlink to directory:'));
        }
        await fs.remove(claudeSkillsDir);
        console.log(chalk.cyan('  Removed old symlink .claude/skills'));
      }
    } catch {
      // Doesn't exist, that's fine
    }
    
    await fs.ensureDir(claudeSkillsDir);
    
    // Remove old lisa symlink if it exists and create new one
    try {
      await fs.lstat(claudeSkillsLisaLink);
      await fs.remove(claudeSkillsLisaLink);
    } catch {
      // Doesn't exist
    }
    await createSymlink(skillsDir, claudeSkillsLisaLink, cwd);
    
    // Create .claude/rules/ directory (preserve user content)
    const claudeRulesDir = path.join(claudeDir, 'rules');
    const claudeRulesLisaLink = path.join(claudeRulesDir, 'lisa');
    
    // Handle migration from old whole-folder symlink
    try {
      const rulesStat = await fs.lstat(claudeRulesDir);
      if (rulesStat.isSymbolicLink()) {
        // Old symlink - remove it and create directory
        if (verbose) {
          console.log(chalk.cyan('\nMigrating .claude/rules from symlink to directory:'));
        }
        await fs.remove(claudeRulesDir);
        console.log(chalk.cyan('  Removed old symlink .claude/rules'));
      }
    } catch {
      // Doesn't exist, that's fine
    }
    
    await fs.ensureDir(claudeRulesDir);
    
    // Remove old lisa symlink if it exists and create new one
    try {
      await fs.lstat(claudeRulesLisaLink);
      await fs.remove(claudeRulesLisaLink);
    } catch {
      // Doesn't exist
    }
    await createSymlink(rulesDir, claudeRulesLisaLink, cwd);
    
    // Merge Lisa hook configuration into .claude/settings.json
    const settingsPath = path.join(claudeDir, 'settings.json');
    await mergeClaudeSettings(settingsPath, verbose);
    
    // Clean up old files that are no longer needed
    await cleanupOldClaudeFiles(claudeDir, verbose);
    
    if (verbose) {
      console.log(chalk.green('  Created .claude/skills/lisa/ -> .lisa/skills'));
      console.log(chalk.green('  Created .claude/rules/lisa/ -> .lisa/rules'));
      console.log(chalk.green('  Merged hook configuration into .claude/settings.json'));
    }
  }

  // OpenCode scaffolding - only if OpenCode is selected
  // Uses subdirectory symlinks to avoid destroying user's existing files
  if (supportOpenCode) {
    const opencodeDir = path.join(cwd, '.opencode');
    const pluginDir = path.join(opencodeDir, 'plugin');
    await fs.ensureDir(pluginDir);
    
    // Copy bundled OpenCode plugin
    const pluginSrc = path.join(BUNDLED_OPENCODE_ROOT, 'lisa.js');
    const pluginDest = path.join(pluginDir, 'lisa.js');
    if (await fs.pathExists(pluginSrc)) {
      copies.push(fs.copy(pluginSrc, pluginDest, { overwrite: force }));
    }
    
    // Create .opencode/skills/ directory (preserve user content)
    const opencodeSkillsDir = path.join(opencodeDir, 'skills');
    
    // Handle migration from old whole-folder symlink
    try {
      const skillsStat = await fs.lstat(opencodeSkillsDir);
      if (skillsStat.isSymbolicLink()) {
        await fs.remove(opencodeSkillsDir);
        if (verbose) {
          console.log(chalk.cyan('  Removed old symlink .opencode/skills'));
        }
      }
    } catch {
      // Doesn't exist
    }
    
    await fs.ensureDir(opencodeSkillsDir);
    
    // OpenCode expects skills directly in .opencode/skills/<skill>/SKILL.md
    // Create individual symlinks for each Lisa skill
    const lisaSkills = ['memory', 'tasks', 'lisa', 'git', 'jira', 'init-review', 'prompt'];
    for (const skill of lisaSkills) {
      const skillLink = path.join(opencodeSkillsDir, skill);
      const skillTarget = path.join(skillsDir, skill);
      
      // Only create if the skill exists in .lisa/skills
      if (await fs.pathExists(skillTarget)) {
        try {
          await fs.lstat(skillLink);
          await fs.remove(skillLink);
        } catch {
          // Doesn't exist
        }
        // Pass absolute path so createSymlink calculates correct relative path
        await createSymlink(skillTarget, skillLink, cwd);
      }
    }
    
    if (verbose) {
      console.log(chalk.green(`  Created .opencode/skills/{${lisaSkills.join(',')}} -> .lisa/skills/*`));
    }
  }

  if (includeDocker) {
    // Choose compose file based on mode
    const composeTemplate = '.lisa/docker/docker-compose.graphiti.yml';
    copies.push(services.templateCopier.copy(composeTemplate, composeDest, replacements, force));
  }

  await Promise.all(copies);

  // Build scaffolded directories list
  const scaffoldedDirs = ['.lisa'];
  if (supportClaudeCode) scaffoldedDirs.push('.claude');
  if (supportOpenCode) scaffoldedDirs.push('.opencode');
  if (includeDocker) scaffoldedDirs.push('Docker assets');

  console.log(chalk.green(`Scaffolded ${scaffoldedDirs.join(', ')} into ${cwd}`));
  console.log(`Mode: ${config.mode}`);
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Group ID: ${config.groupId}`);
  console.log(`CLI Support: ${cliSupport.join(', ')}`);

  // Show skip mode instructions
  if (config.mode === 'skip') {
    console.log('');
    console.log(chalk.cyan('To configure storage later:'));
    console.log(chalk.cyan('  1. Read .lisa/docs/STORAGE_SETUP.md'));
    console.log(chalk.cyan('  2. Edit .lisa/.env with your configuration'));
    console.log(chalk.cyan('  3. Start a new terminal session'));
    console.log(chalk.cyan('  4. Run `lisa doctor` to verify connection'));
  }

  // Isolated mode: create .claude/lib structure for non-npm projects
  if (opts.isolated) {
    const libDir = path.join(claudeDir, 'lib');
    await fs.ensureDir(libDir);

    // Create minimal package.json in .claude/lib
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

    // Add .claude/lib to .gitignore if not already there
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
}

async function loadConfig(cwd: string): Promise<{ endpoint?: string; group?: string; mode?: DeploymentMode; zepApiKey?: string } | null> {
  // Read from .env file (legacy/runtime config)
  const lisaEnv = path.join(cwd, '.lisa', '.env');
  const map: Record<string, string> = {};
  if (await fs.pathExists(lisaEnv)) {
    const raw = await fs.readFile(lisaEnv, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      if (!line || line.startsWith('#')) return;
      const idx = line.indexOf('=');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      map[key] = line.slice(idx + 1).trim();
    });
  }

  // If no .env exists, return null
  if (Object.keys(map).length === 0) {
    return null;
  }

  return {
    endpoint: map.GRAPHITI_ENDPOINT || DEFAULT_ENDPOINT,
    group: map.GRAPHITI_GROUP_ID || DEFAULT_GROUP,
    mode: (map.STORAGE_MODE as DeploymentMode) || 'local',
    zepApiKey: map.ZEP_API_KEY,
  };
}

async function doctorCommand(opts: { cwd: string; compose?: string; endpoint?: string }, services: IServices) {
  const cwd = opts.cwd;
  // Default compose file location is at project root (deployed by init command)
  const composeFile = opts.compose || path.join(cwd, 'docker-compose.graphiti.yml');
  const config = (await loadConfig(cwd)) ?? { endpoint: undefined, group: undefined, mode: 'local' as DeploymentMode };
  const endpoint = opts.endpoint || config.endpoint || DEFAULT_ENDPOINT;
  const mode = config.mode || 'local';

  const results: string[] = [];

  // Show current mode
  results.push(chalk.cyan(`Mode: ${mode}`));
  results.push(chalk.cyan(`Group: ${config.group || DEFAULT_GROUP}`));
  results.push('');

  // Mode-specific checks
  if (mode === 'zep-cloud') {
    // Zep Cloud mode - no local Docker needed
    results.push(chalk.yellow('Zep Cloud mode - no local Docker required'));
    results.push('');

    // Get API key from config or environment for Zep Cloud authentication
    const zepApiKey = config.zepApiKey || process.env.ZEP_API_KEY;
    if (!zepApiKey) {
      results.push(chalk.yellow('Warning: ZEP_API_KEY not configured (required for Zep Cloud)'));
    }

    try {
      await services.mcp.ping(endpoint, { apiKey: zepApiKey });
      results.push(chalk.green(`Zep MCP reachable at ${endpoint}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(chalk.red(`Zep MCP check failed at ${endpoint}: ${message}`));
    }
  } else if (mode === 'skip') {
    // Skip mode - memory/tasks not configured
    results.push(chalk.yellow('Skip mode - memory/tasks not configured'));
    results.push(chalk.yellow('Run "lisa init" again to configure storage backend'));
  } else {
    // Local mode - Docker is needed
    try {
      const stdout = await services.docker.version();
      results.push(chalk.green(`Docker OK: ${stdout}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(chalk.red(`Docker missing or not running: ${message}`));
    }

    try {
      const stdout = await services.docker.composeVersion();
      results.push(chalk.green(`Docker Compose OK: ${stdout}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(chalk.red(`Docker Compose missing: ${message}`));
    }

    if (await fs.pathExists(composeFile)) {
      results.push(chalk.green(`Compose file found: ${composeFile}`));
    } else {
      results.push(chalk.red(`Compose file not found: ${composeFile}`));
    }

    try {
      await services.mcp.ping(endpoint);
      results.push(chalk.green(`MCP reachable at ${endpoint}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(chalk.red(`MCP check failed at ${endpoint}: ${message}`));
    }

  }

  console.log(results.join('\n'));
}

async function upCommand(opts: { composeFile: string }, services: IServices) {
  await services.docker.compose(opts.composeFile, ['up', '-d']);
}

async function downCommand(opts: { composeFile: string }, services: IServices) {
  await services.docker.compose(opts.composeFile, ['down']);
}

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
  .description('Validate Docker and MCP connectivity')
  .option('-c, --compose <file>', 'Compose file', 'docker-compose.graphiti.yml')
  .option('-e, --endpoint <url>', 'MCP endpoint override')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await doctorCommand({ cwd: process.cwd(), compose: cmd.compose, endpoint: cmd.endpoint }, services);
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
