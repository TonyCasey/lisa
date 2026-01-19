#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { select, input, password, checkbox } from '@inquirer/prompts';
import { createDefaultServices, IServices } from './services';
import { runScan, IScanOptions } from './scanner';
import { createLogger, withCorrelation } from './infrastructure/logging';

// Templates are copied into dist/project by postbuild; resolve relative to compiled file.
const TEMPLATE_ROOT = path.join(__dirname, '..', 'project');
// Bundled hooks and plugins are in dist/hooks and dist/opencode
const BUNDLED_HOOKS_ROOT = path.join(__dirname, '..', 'hooks');
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

interface ILisaConfig {
  graphiti: IGraphitiConfig;
  cliSupport: CliSupport[];
}

/**
 * Create a symlink with Windows fallback.
 * On Windows, tries junction first, then falls back to directory copy.
 * Records copy fallbacks for later sync.
 */
async function createSymlink(target: string, link: string, cwd?: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  const projectRoot = cwd || process.cwd();
  
  // Skip if link already exists
  if (await fs.pathExists(link)) {
    return;
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

// Interactive prompt functions
async function promptDeploymentMode(): Promise<DeploymentMode> {
  return await select({
    message: 'How would you like to configure storage?',
    choices: [
      {
        name: 'Local Docker (runs Neo4j + MCP server locally)',
        value: 'local' as DeploymentMode,
      },
      {
        name: 'Zep Cloud (managed storage service)',
        value: 'zep-cloud' as DeploymentMode,
      },
      {
        name: 'Set up later (scaffold project, configure storage later)',
        value: 'skip' as DeploymentMode,
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
}, services: IServices) {
  const force = Boolean(opts.force);
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
    let modeConfig: Partial<IGraphitiConfig> = {};

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

  // Skill scaffolding (model-neutral)
  copies.push(services.templateCopier.copy('.lisa/skills/memory/SKILL.md', path.join(skillsDir, 'memory', 'SKILL.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/skills/tasks/SKILL.md', path.join(skillsDir, 'tasks', 'SKILL.md'), replacements, force));

  // Rules scaffolding (shared)
  copies.push(services.templateCopier.copy('.lisa/rules/shared/clean-architecture.md', path.join(rulesDir, 'shared', 'clean-architecture.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/code-quality-rules.md', path.join(rulesDir, 'shared', 'code-quality-rules.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/shared/testing-principles.md', path.join(rulesDir, 'shared', 'testing-principles.md'), replacements, force));

  // Rules scaffolding (typescript)
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/coding-standards.md', path.join(rulesDir, 'typescript', 'coding-standards.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/testing.md', path.join(rulesDir, 'typescript', 'testing.md'), replacements, force));
  copies.push(services.templateCopier.copy('.lisa/rules/typescript/typescript-config-guide.md', path.join(rulesDir, 'typescript', 'typescript-config-guide.md'), replacements, force));

  // Claude Code scaffolding (hooks and settings) - only if Claude Code is selected
  if (supportClaudeCode) {
    copies.push(services.templateCopier.copy('.claude/config.js', path.join(claudeDir, 'config.js'), replacements, force));
    
    // Copy bundled hooks (these are pre-bundled with all dependencies)
    const hooksDir = path.join(claudeDir, 'hooks');
    await fs.ensureDir(hooksDir);
    const bundledHooks = ['session-start.js', 'session-stop.js', 'user-prompt-submit.js'];
    for (const hook of bundledHooks) {
      const src = path.join(BUNDLED_HOOKS_ROOT, hook);
      const dest = path.join(hooksDir, hook);
      if (await fs.pathExists(src)) {
        copies.push(fs.copy(src, dest, { overwrite: force }));
      }
    }
    
    // Create symlinks for .claude/skills and .claude/rules
    await createSymlink(skillsDir, path.join(claudeDir, 'skills'), cwd);
    await createSymlink(rulesDir, path.join(claudeDir, 'rules'), cwd);
  }

  // OpenCode scaffolding - only if OpenCode is selected
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
    
    // Create symlink for .opencode/skills
    await createSymlink(skillsDir, path.join(opencodeDir, 'skills'), cwd);
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

  // Save config to .lisa/lisa.config.json
  const lisaConfigPath = path.join(lisaDir, 'lisa.config.json');
  const lisaConfig: ILisaConfig = {
    graphiti: config,
    cliSupport,
  };
  await fs.ensureDir(lisaDir);
  await fs.writeJson(lisaConfigPath, lisaConfig, { spaces: 2 });
  console.log(chalk.green(`Saved configuration to ${lisaConfigPath}`));

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
  const lisaEnv = path.join(cwd, '.lisa', '.env');
  if (!(await fs.pathExists(lisaEnv))) return null;
  const raw = await fs.readFile(lisaEnv, 'utf8');
  const map: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map[key] = val;
  });
  return {
    endpoint: map.GRAPHITI_ENDPOINT || DEFAULT_ENDPOINT,
    group: map.GRAPHITI_GROUP_ID || DEFAULT_GROUP,
    mode: (map.STORAGE_MODE as DeploymentMode) || 'local',
    zepApiKey: map.ZEP_API_KEY,
  };
}

async function doctorCommand(opts: { cwd: string; compose?: string; endpoint?: string }, services: IServices) {
  const cwd = opts.cwd;
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
  .action(async (cmd) => {
    await withCorrelation(async () => {
      const log = cliLogger.child({ command: 'init' });
      log.info('Starting init command', { 
        mode: cmd.mode, 
        claudeOnly: cmd.claudeOnly, 
        opencodeOnly: cmd.opencodeOnly 
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
  .action(async (cmd) => {
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
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
  TEMPLATE_ROOT,
  runScan,
};
