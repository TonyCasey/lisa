#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { select, input, password } from '@inquirer/prompts';
import { createDefaultServices, IServices } from './lib/services';
import { runScan, IScanOptions, IScanResult } from './lib/scanner';

// Templates are copied into dist/templates by postbuild; resolve relative to compiled file.
const TEMPLATE_ROOT = path.join(__dirname, 'templates');

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

// Deployment mode types
type DeploymentMode = 'local' | 'zep-cloud' | 'skip';

interface IGraphitiConfig {
  mode: DeploymentMode;
  endpoint: string;
  groupId: string;
  // Zep Cloud specific
  zepApiKey?: string;
  zepProjectId?: string;
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
}, services: IServices) {
  const force = Boolean(opts.force);
  const cwd = opts.cwd;
  let config: IGraphitiConfig;

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

    config = {
      mode,
      endpoint: modeConfig.endpoint || DEFAULT_ENDPOINT,
      groupId,
      ...modeConfig,
    };
  }

  const includeDocker = opts.includeDocker !== false && config.mode !== 'zep-cloud' && config.mode !== 'skip';

  const replacements = {
    GRAPHITI_ENDPOINT: config.endpoint,
    GRAPHITI_GROUP: config.groupId,
    PROJECT_NAME: config.groupId,
  };

  const agentsDir = path.join(cwd, '.agents');
  const skillsDir = path.join(agentsDir, 'skills');
  const rulesDir = path.join(agentsDir, 'rules');
  const claudeDir = path.join(cwd, '.claude');
  const composeDest = path.join(cwd, 'docker-compose.graphiti.yml');
  const envDest = path.join(cwd, '.env.lisa.example');
  const agentsEnvDest = path.join(agentsDir, '.env');

  const copies: Array<Promise<any>> = [];

  // Skill scaffolding (model-neutral)
  copies.push(services.templateCopier.copy('agents/skills/memory/SKILL.md', path.join(skillsDir, 'memory', 'SKILL.md'), replacements, force));
  copies.push(services.templateCopier.copy('agents/skills/tasks/SKILL.md', path.join(skillsDir, 'tasks', 'SKILL.md'), replacements, force));

  // Rules scaffolding (shared)
  copies.push(services.templateCopier.copy('rules/shared/clean-architecture.md', path.join(rulesDir, 'shared', 'clean-architecture.md'), replacements, force));
  copies.push(services.templateCopier.copy('rules/shared/code-quality-rules.md', path.join(rulesDir, 'shared', 'code-quality-rules.md'), replacements, force));
  copies.push(services.templateCopier.copy('rules/shared/testing-principles.md', path.join(rulesDir, 'shared', 'testing-principles.md'), replacements, force));

  // Rules scaffolding (typescript)
  copies.push(services.templateCopier.copy('rules/typescript/coding-standards.md', path.join(rulesDir, 'typescript', 'coding-standards.md'), replacements, force));
  copies.push(services.templateCopier.copy('rules/typescript/testing.md', path.join(rulesDir, 'typescript', 'testing.md'), replacements, force));
  copies.push(services.templateCopier.copy('rules/typescript/typescript-config-guide.md', path.join(rulesDir, 'typescript', 'typescript-config-guide.md'), replacements, force));

  // Claude Code scaffolding (hooks and settings)
  copies.push(services.templateCopier.copy('claude/settings.json', path.join(claudeDir, 'settings.json'), replacements, force));
  copies.push(services.templateCopier.copy('claude/config.js', path.join(claudeDir, 'config.js'), replacements, force));
  copies.push(services.templateCopier.copy('claude/hooks/user-prompt-submit.js', path.join(claudeDir, 'hooks', 'user-prompt-submit.js'), replacements, force));

  // Storage setup documentation
  const docsDir = path.join(agentsDir, 'docs');
  copies.push(services.templateCopier.copy('agents/docs/STORAGE_SETUP.md', path.join(docsDir, 'STORAGE_SETUP.md'), replacements, force));

  // Copy .env template with replacements
  copies.push(services.templateCopier.copy('agents/.sample.env', agentsEnvDest, replacements, force));

  if (includeDocker) {
    // Choose compose file based on mode
    const composeTemplate = 'docker/docker-compose.graphiti.yml';
    copies.push(services.templateCopier.copy(composeTemplate, composeDest, replacements, force));
    copies.push(services.templateCopier.copy('docker/.env.lisa.example', envDest, replacements, force));
  }

  await Promise.all(copies);
  console.log(chalk.green(`Scaffolded .agents, .claude${includeDocker ? ', and Docker assets' : ''} into ${cwd}`));
  console.log(`Mode: ${config.mode}`);
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Group ID: ${config.groupId}`);

  // Show skip mode instructions
  if (config.mode === 'skip') {
    console.log('');
    console.log(chalk.cyan('To configure storage later:'));
    console.log(chalk.cyan('  1. Read .agents/docs/STORAGE_SETUP.md'));
    console.log(chalk.cyan('  2. Edit .agents/.env with your configuration'));
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
  const agentsEnv = path.join(cwd, '.agents', '.env');
  if (!(await fs.pathExists(agentsEnv))) return null;
  const raw = await fs.readFile(agentsEnv, 'utf8');
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
    } catch (err: any) {
      results.push(chalk.red(`Zep MCP check failed at ${endpoint}: ${err.message}`));
    }
  } else {
    // Local mode - Docker is needed
    try {
      const stdout = await services.docker.version();
      results.push(chalk.green(`Docker OK: ${stdout}`));
    } catch (err: any) {
      results.push(chalk.red(`Docker missing or not running: ${err.message}`));
    }

    try {
      const stdout = await services.docker.composeVersion();
      results.push(chalk.green(`Docker Compose OK: ${stdout}`));
    } catch (err: any) {
      results.push(chalk.red(`Docker Compose missing: ${err.message}`));
    }

    if (await fs.pathExists(composeFile)) {
      results.push(chalk.green(`Compose file found: ${composeFile}`));
    } else {
      results.push(chalk.red(`Compose file not found: ${composeFile}`));
    }

    try {
      await services.mcp.ping(endpoint);
      results.push(chalk.green(`MCP reachable at ${endpoint}`));
    } catch (err: any) {
      results.push(chalk.red(`MCP check failed at ${endpoint}: ${err.message}`));
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
  .version('0.5.0');

program
  .command('init')
  .description('Scaffold .agents, .claude, and Docker assets')
  .option('-e, --endpoint <url>', 'MCP endpoint')
  .option('-g, --group <id>', 'Default group id')
  .option('-f, --force', 'Overwrite existing files')
  .option('-m, --mode <mode>', 'Deployment mode: local or zep-cloud')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .option('--isolated', 'Install to .claude/lib for non-npm projects (Python, Go, etc.)')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
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
    }, services);
  });

program
  .command('setup')
  .description('Scaffold .agents and .claude only (no Docker assets)')
  .option('-e, --endpoint <url>', 'MCP endpoint')
  .option('-g, --group <id>', 'Default group id')
  .option('-f, --force', 'Overwrite existing files')
  .option('-m, --mode <mode>', 'Deployment mode: local or zep-cloud')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .option('--isolated', 'Install to .claude/lib for non-npm projects (Python, Go, etc.)')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
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
    const scanPath = targetPath || process.cwd();
    const options: IScanOptions = {
      dryRun: cmd.dryRun,
      clean: cmd.clean,
      verbose: cmd.verbose,
    };

    try {
      const result = await runScan(scanPath, options);
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      console.error(chalk.red(`Scan failed: ${err instanceof Error ? err.message : err}`));
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
