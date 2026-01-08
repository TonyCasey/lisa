#!/usr/bin/env node
/**
 * postinstall.js
 *
 * Automatically scaffolds .agents/ and .claude/ folders when the package is installed.
 * This enables plug-and-play memory and rules for Claude Code.
 *
 * Interactive prompts default to "yes" for seamless installation.
 */
const path = require('path');
const fs = require('fs-extra');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// When installed as a dependency, the project root is two levels up from node_modules/agent-memory/scripts
// When running locally (development), use the current working directory
const isInstalledAsDependency = __dirname.includes('node_modules');
const projectRoot = isInstalledAsDependency
  ? path.resolve(__dirname, '..', '..', '..')
  : process.cwd();

const templateRoot = path.resolve(__dirname, '..', 'dist', 'templates');

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';
const DEFAULT_GROUP = 'sample-group';

/**
 * Ask a yes/no question with default "yes"
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    // If not interactive (CI, piped input), default to yes
    if (!process.stdin.isTTY) {
      resolve(true);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      // Default to yes (empty or 'y' or 'yes')
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Check if Docker is available and running
 */
function isDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if docker compose is available
 */
function isDockerComposeAvailable() {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync('docker-compose version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Run docker compose command
 */
function runDockerCompose(composeFile, args) {
  return new Promise((resolve, reject) => {
    // Try 'docker compose' first, fall back to 'docker-compose'
    let cmd = 'docker';
    let cmdArgs = ['compose', '-f', composeFile, ...args];

    const child = spawn(cmd, cmdArgs, {
      cwd: projectRoot,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker compose exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function copyTemplates(src, dest, force = false) {
  if (!force && (await fs.pathExists(dest))) {
    return false;
  }
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest, { overwrite: force });
  return true;
}

async function createSymlink(target, linkPath) {
  try {
    if (await fs.pathExists(linkPath)) {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        await fs.remove(linkPath);
      } else {
        return false;
      }
    }
    await fs.ensureDir(path.dirname(linkPath));
    await fs.symlink(target, linkPath, 'dir');
    return true;
  } catch {
    return false;
  }
}

async function writeEnvFile(dest, endpoint, group) {
  if (await fs.pathExists(dest)) {
    return false;
  }
  await fs.ensureDir(path.dirname(dest));
  const content = `GRAPHITI_ENDPOINT=${endpoint}\nGRAPHITI_GROUP_ID=${group}\n`;
  await fs.writeFile(dest, content, 'utf8');
  return true;
}

async function copyDockerFiles() {
  const dockerSrc = path.join(templateRoot, 'docker');
  if (!(await fs.pathExists(dockerSrc))) {
    return false;
  }

  // Copy docker-compose file
  const composeSrc = path.join(dockerSrc, 'docker-compose.graphiti.yml');
  const composeDest = path.join(projectRoot, 'docker-compose.graphiti.yml');
  if (await fs.pathExists(composeSrc)) {
    await fs.copy(composeSrc, composeDest, { overwrite: false });
  }

  // Copy .env.graphiti.example
  const envSrc = path.join(dockerSrc, '.env.graphiti.example');
  const envDest = path.join(projectRoot, '.env.graphiti.example');
  if (await fs.pathExists(envSrc)) {
    await fs.copy(envSrc, envDest, { overwrite: false });
  }

  // Copy mcp_server config
  const mcpConfigSrc = path.join(dockerSrc, 'mcp_server');
  const mcpConfigDest = path.join(projectRoot, 'mcp_server');
  if (await fs.pathExists(mcpConfigSrc)) {
    await fs.copy(mcpConfigSrc, mcpConfigDest, { overwrite: false });
  }

  return true;
}

async function setupDocker() {
  console.log('');

  // Check if Docker is available
  if (!isDockerAvailable()) {
    console.log('  Docker is not running or not installed.');
    console.log('  To enable memory persistence, install Docker and run:');
    console.log('    docker compose -f docker-compose.graphiti.yml up -d');
    return;
  }

  if (!isDockerComposeAvailable()) {
    console.log('  Docker Compose is not available.');
    return;
  }

  // Ask user if they want to start Docker
  const shouldStart = await askYesNo('Start Graphiti memory stack (requires Docker)?');

  if (!shouldStart) {
    console.log('  Skipping Docker setup. Run later with:');
    console.log('    docker compose -f docker-compose.graphiti.yml up -d');
    return;
  }

  // Copy Docker files
  console.log('  Copying Docker configuration...');
  await copyDockerFiles();

  // Check if .env.graphiti exists, if not copy from example
  const envFile = path.join(projectRoot, '.env.graphiti');
  const envExample = path.join(projectRoot, '.env.graphiti.example');
  if (!(await fs.pathExists(envFile)) && (await fs.pathExists(envExample))) {
    await fs.copy(envExample, envFile);
    console.log('  Created .env.graphiti from example');
    console.log('  IMPORTANT: Edit .env.graphiti and add your OPENAI_API_KEY');
  }

  // Check for required API key
  const envContent = await fs.pathExists(envFile) ? await fs.readFile(envFile, 'utf8') : '';
  if (!envContent.includes('OPENAI_API_KEY=') || envContent.includes('OPENAI_API_KEY=your-')) {
    console.log('');
    console.log('  ⚠️  OPENAI_API_KEY not configured in .env.graphiti');
    console.log('  Graphiti requires an OpenAI API key for LLM-powered classification.');
    console.log('  Please edit .env.graphiti and add your key, then run:');
    console.log('    docker compose -f docker-compose.graphiti.yml up -d');
    return;
  }

  // Start Docker stack
  console.log('  Starting Graphiti memory stack...');
  console.log('  (This may take a few minutes on first run)');

  try {
    const composeFile = path.join(projectRoot, 'docker-compose.graphiti.yml');
    await runDockerCompose(composeFile, ['up', '-d']);
    console.log('');
    console.log('  ✓ Graphiti memory stack is running!');
    console.log('  Neo4j Browser: http://localhost:7474');
    console.log('  Graphiti MCP:  http://localhost:8010');
  } catch (err) {
    console.log(`  Docker startup failed: ${err.message}`);
    console.log('  You can try manually with:');
    console.log('    docker compose -f docker-compose.graphiti.yml up -d');
  }
}

async function main() {
  console.log('');
  console.log('agent-memory: Setting up Claude Code memory and rules...');
  console.log('');

  // Check if templates exist
  if (!(await fs.pathExists(templateRoot))) {
    console.error('  Templates not found. Package may not be built correctly.');
    process.exit(1);
  }

  const agentsDir = path.join(projectRoot, '.agents');
  const claudeDir = path.join(projectRoot, '.claude');

  // Copy .agents templates
  const agentsSrc = path.join(templateRoot, 'agents');
  const rulesSrc = path.join(templateRoot, 'rules');

  if (await fs.pathExists(agentsSrc)) {
    const skillsSrc = path.join(agentsSrc, 'skills');
    if (await fs.pathExists(skillsSrc)) {
      await copyTemplates(skillsSrc, path.join(agentsDir, 'skills'));
      console.log('  ✓ Copied .agents/skills/');
    }
  }

  if (await fs.pathExists(rulesSrc)) {
    await copyTemplates(rulesSrc, path.join(agentsDir, 'rules'));
    console.log('  ✓ Copied .agents/rules/');
  }

  // Copy .claude templates
  const claudeSrc = path.join(templateRoot, 'claude');
  if (await fs.pathExists(claudeSrc)) {
    await copyTemplates(path.join(claudeSrc, 'settings.json'), path.join(claudeDir, 'settings.json'));
    await copyTemplates(path.join(claudeSrc, 'config.js'), path.join(claudeDir, 'config.js'));
    await copyTemplates(path.join(claudeSrc, 'hooks'), path.join(claudeDir, 'hooks'));
    console.log('  ✓ Copied .claude/ hooks and settings');
  }

  // Create symlinks
  if (await createSymlink('../.agents/rules', path.join(claudeDir, 'rules'))) {
    console.log('  ✓ Created symlink .claude/rules');
  }
  if (await createSymlink('../.agents/skills', path.join(claudeDir, 'skills'))) {
    console.log('  ✓ Created symlink .claude/skills');
  }

  // Create .env with defaults
  const envPath = path.join(agentsDir, 'skills', '.env');
  const endpoint = process.env.GRAPHITI_ENDPOINT || DEFAULT_ENDPOINT;
  const group = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP;
  await writeEnvFile(envPath, endpoint, group);

  // Docker setup with interactive prompt
  await setupDocker();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  agent-memory: Setup complete!');
  console.log('  Claude Code now has automatic memory and coding rules.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

main().catch((err) => {
  console.error('agent-memory postinstall failed:', err.message);
  // Don't exit with error - allow npm install to complete
});