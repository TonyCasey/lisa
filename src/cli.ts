#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createDefaultServices, IServices } from './lib/services';

// Templates are copied into dist/templates by postbuild; resolve relative to compiled file.
const TEMPLATE_ROOT = path.join(__dirname, 'templates');

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
const DEFAULT_GROUP = 'sample-group';

async function initCommand(opts: {
  endpoint?: string;
  group?: string;
  force?: boolean;
  cwd: string;
  includeDocker?: boolean;
}, services: IServices) {
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const group = opts.group || process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP;
  const force = Boolean(opts.force);
  const cwd = opts.cwd;
  const includeDocker = opts.includeDocker !== false;

  const replacements = {
    GRAPHITI_ENDPOINT: endpoint,
    GRAPHITI_GROUP: group,
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

  // Provide a baseline skills .env configured to the chosen endpoint/group.
  if (force || !(await fs.pathExists(skillsEnvDest))) {
    await fs.ensureDir(path.dirname(skillsEnvDest));
    const envContent = `GRAPHITI_ENDPOINT=${endpoint}\nGRAPHITI_GROUP_ID=${group}\n`;
    await fs.writeFile(skillsEnvDest, envContent, 'utf8');
  }

  if (includeDocker) {
    copies.push(services.templateCopier.copy('docker/docker-compose.graphiti.yml', composeDest, replacements, force));
    copies.push(services.templateCopier.copy('docker/.env.graphiti.example', envDest, replacements, force));
  }

  await Promise.all(copies);
  console.log(chalk.green(`Scaffolded .agents, .claude${includeDocker ? ', and Docker assets' : ''} into ${cwd}`));
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Group ID: ${group}`);
}

async function loadConfig(cwd: string): Promise<{ endpoint?: string; group?: string } | null> {
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
  };
}

async function doctorCommand(opts: { cwd: string; compose?: string; endpoint?: string }, services: IServices) {
  const cwd = opts.cwd;
  const composeFile = opts.compose || path.join(cwd, 'docker-compose.graphiti.yml');
  const config = (await loadConfig(cwd)) ?? { endpoint: undefined, group: undefined };
  const endpoint = opts.endpoint || config.endpoint || DEFAULT_ENDPOINT;

  const results: string[] = [];

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
  .name('agent-memory')
  .description('Scaffold and manage Graphiti memory hooks + Docker stack')
  .version('0.1.0');

program
  .command('init')
  .description('Scaffold .agents, .claude, and Docker assets')
  .option('-e, --endpoint <url>', 'MCP endpoint', DEFAULT_ENDPOINT)
  .option('-g, --group <id>', 'Default group id', DEFAULT_GROUP)
  .option('-f, --force', 'Overwrite existing files')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await initCommand({
      endpoint: cmd.endpoint,
      group: cmd.group,
      force: cmd.force,
      cwd: process.cwd(),
      includeDocker: true,
    }, services);
  });

program
  .command('setup')
  .description('Scaffold .agents and .claude only (no Docker assets)')
  .option('-e, --endpoint <url>', 'MCP endpoint', DEFAULT_ENDPOINT)
  .option('-g, --group <id>', 'Default group id', DEFAULT_GROUP)
  .option('-f, --force', 'Overwrite existing files')
  .action(async (cmd) => {
    const services = createDefaultServices(TEMPLATE_ROOT);
    await initCommand({
      endpoint: cmd.endpoint,
      group: cmd.group,
      force: cmd.force,
      cwd: process.cwd(),
      includeDocker: false,
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
