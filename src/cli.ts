#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { select, input, password } from '@inquirer/prompts';
import { createDefaultServices, IServices } from './lib/services';

// Templates are copied into dist/templates by postbuild; resolve relative to compiled file.
const TEMPLATE_ROOT = path.join(__dirname, 'templates');

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
const DEFAULT_GROUP = 'sample-group';
const ZEP_CLOUD_ENDPOINT = 'https://api.getzep.com/mcp/';

// Deployment mode types
type DeploymentMode = 'local' | 'remote-neo4j' | 'zep-cloud' | 'skip';

interface IGraphitiConfig {
  mode: DeploymentMode;
  endpoint: string;
  groupId: string;
  // Remote Neo4j specific
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  openaiApiKey?: string;
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
        name: 'Remote Neo4j (connect to Neo4j Aura or remote instance)',
        value: 'remote-neo4j' as DeploymentMode,
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

async function promptRemoteNeo4jConfig(): Promise<Partial<IGraphitiConfig>> {
  const neo4jUri = await input({
    message: 'Neo4j URI (e.g., neo4j+s://xxxxx.databases.neo4j.io):',
    validate: (val) => val.length > 0 || 'URI is required',
  });

  const neo4jUser = await input({
    message: 'Neo4j Username:',
    default: 'neo4j',
  });

  const neo4jPassword = await password({
    message: 'Neo4j Password:',
    validate: (val) => val.length > 0 || 'Password is required',
  });

  const openaiApiKey = await password({
    message: 'OpenAI API Key (for embeddings):',
    validate: (val) => val.startsWith('sk-') || 'Must be a valid OpenAI API key',
  });

  const endpoint = await input({
    message: 'Graphiti MCP Endpoint:',
    default: DEFAULT_ENDPOINT,
  });

  return {
    neo4jUri,
    neo4jUser,
    neo4jPassword,
    openaiApiKey,
    endpoint,
  };
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

// Generate .env content based on mode
function generateEnvContent(config: IGraphitiConfig): string {
  // For 'skip' mode, generate a template with commented examples
  if (config.mode === 'skip') {
    return `# Storage Configuration
# See .agents/docs/STORAGE_SETUP.md for setup instructions

GRAPHITI_GROUP_ID=${config.groupId}
GRAPHITI_MODE=skip

# Uncomment ONE of the following configurations:

# === Option 1: Local Docker ===
# GRAPHITI_MODE=local
# GRAPHITI_ENDPOINT=http://localhost:8010/mcp/

# === Option 2: Remote Neo4j ===
# GRAPHITI_MODE=remote-neo4j
# GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
# NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
# NEO4J_USER=neo4j
# NEO4J_PASSWORD=your-password
# OPENAI_API_KEY=sk-xxxxx

# === Option 3: Zep Cloud ===
# GRAPHITI_MODE=zep-cloud
# GRAPHITI_ENDPOINT=https://api.getzep.com/mcp/
# ZEP_API_KEY=zep_xxxxx
# ZEP_PROJECT_ID=your-project-id
`;
  }

  const lines: string[] = [
    `GRAPHITI_ENDPOINT=${config.endpoint}`,
    `GRAPHITI_GROUP_ID=${config.groupId}`,
    `GRAPHITI_MODE=${config.mode}`,
  ];

  if (config.mode === 'remote-neo4j') {
    lines.push(`NEO4J_URI=${config.neo4jUri || ''}`);
    lines.push(`NEO4J_USER=${config.neo4jUser || 'neo4j'}`);
    // Store as env var reference for security
    lines.push(`NEO4J_PASSWORD=\${NEO4J_PASSWORD}`);
    lines.push(`OPENAI_API_KEY=\${OPENAI_API_KEY}`);
  } else if (config.mode === 'zep-cloud') {
    lines.push(`ZEP_API_KEY=\${ZEP_API_KEY}`);
    lines.push(`ZEP_PROJECT_ID=${config.zepProjectId || ''}`);
  }

  return lines.join('\n') + '\n';
}

// Generate .env.local with actual secrets (gitignored)
function generateEnvLocalContent(config: IGraphitiConfig): string {
  const lines: string[] = ['# Local secrets - DO NOT COMMIT'];

  if (config.mode === 'remote-neo4j') {
    lines.push(`NEO4J_PASSWORD=${config.neo4jPassword || ''}`);
    lines.push(`OPENAI_API_KEY=${config.openaiApiKey || ''}`);
  } else if (config.mode === 'zep-cloud') {
    lines.push(`ZEP_API_KEY=${config.zepApiKey || ''}`);
  }

  return lines.join('\n') + '\n';
}

async function initCommand(opts: {
  endpoint?: string;
  group?: string;
  force?: boolean;
  cwd: string;
  includeDocker?: boolean;
  mode?: DeploymentMode;
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  openaiApiKey?: string;
  zepApiKey?: string;
  zepProjectId?: string;
  yes?: boolean; // Skip prompts, use defaults
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
      neo4jUri: opts.neo4jUri,
      neo4jUser: opts.neo4jUser,
      neo4jPassword: opts.neo4jPassword,
      openaiApiKey: opts.openaiApiKey,
      zepApiKey: opts.zepApiKey,
      zepProjectId: opts.zepProjectId,
    };
  } else {
    // Interactive mode - prompt user
    const mode = await promptDeploymentMode();
    let modeConfig: Partial<IGraphitiConfig> = {};

    if (mode === 'remote-neo4j') {
      modeConfig = await promptRemoteNeo4jConfig();
    } else if (mode === 'zep-cloud') {
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
  };

  const agentsDir = path.join(cwd, '.agents');
  const skillsDir = path.join(agentsDir, 'skills');
  const rulesDir = path.join(agentsDir, 'rules');
  const claudeDir = path.join(cwd, '.claude');
  const composeDest = path.join(cwd, 'docker-compose.graphiti.yml');
  const envDest = path.join(cwd, '.env.graphiti.example');
  const skillsEnvDest = path.join(skillsDir, '.env');

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

  // Provide a baseline skills .env configured to the chosen mode/endpoint/group.
  if (force || !(await fs.pathExists(skillsEnvDest))) {
    await fs.ensureDir(path.dirname(skillsEnvDest));
    const envContent = generateEnvContent(config);
    await fs.writeFile(skillsEnvDest, envContent, 'utf8');

    // Write secrets to .env.local (should be gitignored)
    if (config.mode !== 'local' && config.mode !== 'skip') {
      const envLocalDest = path.join(skillsDir, '.env.local');
      const envLocalContent = generateEnvLocalContent(config);
      await fs.writeFile(envLocalDest, envLocalContent, 'utf8');
      console.log(chalk.yellow('Secrets saved to .agents/skills/.env.local - add to .gitignore!'));
    }
  }

  if (includeDocker) {
    // Choose compose file based on mode
    const composeTemplate = config.mode === 'remote-neo4j'
      ? 'docker/docker-compose.remote-neo4j.yml'
      : 'docker/docker-compose.graphiti.yml';
    copies.push(services.templateCopier.copy(composeTemplate, composeDest, replacements, force));
    copies.push(services.templateCopier.copy('docker/.env.graphiti.example', envDest, replacements, force));
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
    console.log(chalk.cyan('  2. Edit .agents/skills/.env with your configuration'));
    console.log(chalk.cyan('  3. Start a new terminal session'));
    console.log(chalk.cyan('  4. Run `lisa doctor` to verify connection'));
  }
}

async function loadConfig(cwd: string): Promise<{ endpoint?: string; group?: string; mode?: DeploymentMode } | null> {
  const skillsEnv = path.join(cwd, '.agents', 'skills', '.env');
  if (!(await fs.pathExists(skillsEnv))) return null;
  const raw = await fs.readFile(skillsEnv, 'utf8');
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
    mode: (map.GRAPHITI_MODE as DeploymentMode) || 'local',
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

    try {
      await services.mcp.ping(endpoint);
      results.push(chalk.green(`Zep MCP reachable at ${endpoint}`));
    } catch (err: any) {
      results.push(chalk.red(`Zep MCP check failed at ${endpoint}: ${err.message}`));
    }
  } else {
    // Local or Remote Neo4j mode - Docker may be needed
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

    // Mode-specific hints
    if (mode === 'remote-neo4j') {
      results.push('');
      results.push(chalk.yellow('Remote Neo4j mode - ensure NEO4J_URI, NEO4J_PASSWORD, and OPENAI_API_KEY are set'));
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
  .option('-m, --mode <mode>', 'Deployment mode: local, remote-neo4j, or zep-cloud')
  .option('--neo4j-uri <uri>', 'Neo4j URI (for remote-neo4j mode)')
  .option('--neo4j-user <user>', 'Neo4j username (for remote-neo4j mode)')
  .option('--neo4j-password <password>', 'Neo4j password (for remote-neo4j mode)')
  .option('--openai-api-key <key>', 'OpenAI API key (for remote-neo4j mode)')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await initCommand({
      endpoint: cmd.endpoint,
      group: cmd.group,
      force: cmd.force,
      cwd: process.cwd(),
      includeDocker: true,
      mode: cmd.mode as DeploymentMode | undefined,
      neo4jUri: cmd.neo4jUri,
      neo4jUser: cmd.neo4jUser,
      neo4jPassword: cmd.neo4jPassword,
      openaiApiKey: cmd.openaiApiKey,
      zepApiKey: cmd.zepApiKey,
      zepProjectId: cmd.zepProjectId,
      yes: cmd.yes,
    }, services);
  });

program
  .command('setup')
  .description('Scaffold .agents and .claude only (no Docker assets)')
  .option('-e, --endpoint <url>', 'MCP endpoint')
  .option('-g, --group <id>', 'Default group id')
  .option('-f, --force', 'Overwrite existing files')
  .option('-m, --mode <mode>', 'Deployment mode: local, remote-neo4j, or zep-cloud')
  .option('--neo4j-uri <uri>', 'Neo4j URI (for remote-neo4j mode)')
  .option('--neo4j-user <user>', 'Neo4j username (for remote-neo4j mode)')
  .option('--neo4j-password <password>', 'Neo4j password (for remote-neo4j mode)')
  .option('--openai-api-key <key>', 'OpenAI API key (for remote-neo4j mode)')
  .option('--zep-api-key <key>', 'Zep API key (for zep-cloud mode)')
  .option('--zep-project-id <id>', 'Zep project ID (for zep-cloud mode)')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await initCommand({
      endpoint: cmd.endpoint,
      group: cmd.group,
      force: cmd.force,
      cwd: process.cwd(),
      includeDocker: false,
      mode: cmd.mode as DeploymentMode | undefined,
      neo4jUri: cmd.neo4jUri,
      neo4jUser: cmd.neo4jUser,
      neo4jPassword: cmd.neo4jPassword,
      openaiApiKey: cmd.openaiApiKey,
      zepApiKey: cmd.zepApiKey,
      zepProjectId: cmd.zepProjectId,
      yes: cmd.yes,
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
};
