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
const net = require('net');
const { glob } = require('glob');

// When installed as a dependency, the project root is four levels up from node_modules/@tonycasey/lisa/scripts
// When running locally (development), use the current working directory
const isInstalledAsDependency = __dirname.includes('node_modules');
const projectRoot = isInstalledAsDependency
  ? path.resolve(__dirname, '..', '..', '..', '..')
  : process.cwd();

const templateRoot = path.resolve(__dirname, '..', 'dist', 'templates');

const DEFAULT_ENDPOINT = 'http://localhost:8010/mcp/';

/**
 * Get project name from package.json or directory name
 */
function getProjectName() {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) {
        // Remove scope prefix if present (e.g., @tonycasey/lisa -> lisa)
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    }
  } catch (_) {
    // Ignore errors reading package.json
  }
  // Fall back to directory name
  return path.basename(projectRoot);
}

const DEFAULT_GROUP = getProjectName();

// Files that indicate this is primarily a non-npm project
const NON_NPM_PROJECT_FILES = [
  'requirements.txt',  // Python
  'pyproject.toml',    // Python
  'setup.py',          // Python
  'go.mod',            // Go
  'Cargo.toml',        // Rust
  'pom.xml',           // Java Maven
  'build.gradle',      // Java Gradle
  'Gemfile',           // Ruby
  'composer.json',     // PHP
];

/**
 * Check if this is primarily a non-npm project (Python, Go, Rust, etc.)
 * Returns true if project has non-npm project files and package.json only has lisa
 */
async function isNonNpmProject() {
  // Check for non-npm project files
  for (const file of NON_NPM_PROJECT_FILES) {
    const filePath = path.join(projectRoot, file);
    if (await fs.pathExists(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Set up isolated mode for non-npm projects
 * Creates .claude/lib/ structure to keep project root clean
 */
async function setupIsolatedMode(claudeDir) {
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
  if (!(await fs.pathExists(libPackagePath))) {
    await fs.writeJson(libPackagePath, libPackageJson, { spaces: 2 });
  }

  // Move node_modules to .claude/lib/ if it exists in project root
  const rootNodeModules = path.join(projectRoot, 'node_modules');
  const libNodeModules = path.join(libDir, 'node_modules');

  if (await fs.pathExists(rootNodeModules) && !(await fs.pathExists(libNodeModules))) {
    await fs.move(rootNodeModules, libNodeModules);
    console.log('  ✓ Moved node_modules to .claude/lib/');
  }

  // Move package.json and package-lock.json to .claude/lib/ if they're minimal (only lisa)
  const rootPackageJson = path.join(projectRoot, 'package.json');
  if (await fs.pathExists(rootPackageJson)) {
    try {
      const pkg = await fs.readJson(rootPackageJson);
      const deps = Object.keys(pkg.dependencies || {});
      // If package.json only has lisa as a dependency, move it to lib
      if (deps.length === 1 && deps[0] === '@tonycasey/lisa') {
        const libPkgPath = path.join(libDir, 'package.json');
        await fs.move(rootPackageJson, libPkgPath, { overwrite: true });
        console.log('  ✓ Moved package.json to .claude/lib/');

        // Also move package-lock.json if exists
        const rootLockFile = path.join(projectRoot, 'package-lock.json');
        if (await fs.pathExists(rootLockFile)) {
          await fs.move(rootLockFile, path.join(libDir, 'package-lock.json'), { overwrite: true });
          console.log('  ✓ Moved package-lock.json to .claude/lib/');
        }
      }
    } catch (e) {
      // Ignore errors reading package.json
    }
  }

  // Add .claude/lib to .gitignore
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (await fs.pathExists(gitignorePath)) {
    let gitignore = await fs.readFile(gitignorePath, 'utf8');
    if (!gitignore.includes('.claude/lib/node_modules')) {
      gitignore += '\n# Lisa support files\n.claude/lib/node_modules/\n';
      await fs.writeFile(gitignorePath, gitignore);
      console.log('  ✓ Added .claude/lib/node_modules to .gitignore');
    }
  }

  return true;
}

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
 * Check if lisa docker containers are already running
 */
function isLisaContainerRunning() {
  try {
    const output = execSync('docker ps --format "{{.Names}}"', { encoding: 'utf8' });
    // Check for lisa-graphiti-mcp container
    return output.includes('lisa-graphiti-mcp') || output.includes('lisa_graphiti-mcp');
  } catch {
    return false;
  }
}

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Update docker-compose file with new port mappings
 */
async function updateDockerComposePorts(composeFile, neo4jBrowserPort, neo4jBoltPort, mcpPort) {
  let content = await fs.readFile(composeFile, 'utf8');

  // Update Neo4j browser port (7474)
  content = content.replace(
    /- "7474:7474"/g,
    `- "${neo4jBrowserPort}:7474"`
  );

  // Update Neo4j bolt port (7687) - host mapping only, internal stays the same
  content = content.replace(
    /- "7687:7687"/g,
    `- "${neo4jBoltPort}:7687"`
  );

  // Update MCP port
  content = content.replace(
    /- "8010:8000"/g,
    `- "${mcpPort}:8000"`
  );

  await fs.writeFile(composeFile, content);

  return { neo4jBrowserPort, neo4jBoltPort, mcpPort };
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

/**
 * Run docker compose in the background without waiting for completion.
 * Output is redirected to a log file.
 */
function runDockerComposeBackground(composeFile, args) {
  const logFile = path.join(path.dirname(composeFile), '.docker-setup.log');
  const logStream = require('fs').createWriteStream(logFile);

  const cmd = 'docker';
  const cmdArgs = ['compose', '-f', composeFile, ...args];

  const child = spawn(cmd, cmdArgs, {
    cwd: projectRoot,
    stdio: ['ignore', logStream, logStream],
    detached: true
  });

  // Unref so parent process can exit
  child.unref();

  return { pid: child.pid, logFile };
}

async function copyTemplates(src, dest, force = false) {
  if (!force && (await fs.pathExists(dest))) {
    return false;
  }
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest, { overwrite: force });
  return true;
}

/**
 * Preserve local extensions (.local.md files and .local/ directories) before deployment.
 * These are user-created files that should survive package updates.
 */
async function preserveLocalExtensions(targetDir) {
  const preserved = { files: [], dirs: [] };

  if (!(await fs.pathExists(targetDir))) {
    return preserved;
  }

  // Find all .local.md files (rules extensions)
  const localFiles = await glob('**/*.local.md', { cwd: targetDir, nodir: true });
  for (const file of localFiles) {
    const fullPath = path.join(targetDir, file);
    const content = await fs.readFile(fullPath, 'utf8');
    preserved.files.push({ path: file, content });
  }

  // Find all .local directories (skill extensions)
  // Use trailing slash to match only directories (glob doesn't support onlyDirectories option)
  const localDirMatches = await glob('**/*.local/', { cwd: targetDir });
  const localDirs = localDirMatches.map(d => d.replace(/\/$/, '')); // Remove trailing slash
  for (const dir of localDirs) {
    const fullPath = path.join(targetDir, dir);
    const files = [];
    const dirFiles = await glob('**/*', { cwd: fullPath, nodir: true });
    for (const file of dirFiles) {
      const filePath = path.join(fullPath, file);
      const content = await fs.readFile(filePath, 'utf8');
      files.push({ path: file, content });
    }
    preserved.dirs.push({ path: dir, files });
  }

  if (preserved.files.length > 0 || preserved.dirs.length > 0) {
    console.log(`  Preserving ${preserved.files.length} local file(s) and ${preserved.dirs.length} local dir(s)`);
  }

  return preserved;
}

/**
 * Restore preserved local extensions after deployment.
 */
async function restoreLocalExtensions(targetDir, preserved) {
  for (const { path: filePath, content } of preserved.files) {
    const fullPath = path.join(targetDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf8');
    console.log(`  ✓ Restored: ${filePath}`);
  }

  for (const { path: dirPath, files } of preserved.dirs) {
    for (const { path: filePath, content } of files) {
      const fullPath = path.join(targetDir, dirPath, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
    }
    console.log(`  ✓ Restored: ${dirPath}/`);
  }
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: object, body: string }
 */
function parseMarkdownWithFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  // Simple YAML parsing for frontmatter (handles basic key: value pairs)
  const frontmatter = {};
  const yamlLines = match[1].split(/\r?\n/);
  for (const line of yamlLines) {
    const kvMatch = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (kvMatch) {
      frontmatter[kvMatch[1]] = kvMatch[2];
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Merge a base SKILL.md with a SKILL.local.md extension.
 * The local file's content is appended after the base content.
 * Frontmatter from base is preserved, with local overrides merged.
 */
function mergeSkillFiles(baseContent, localContent) {
  const base = parseMarkdownWithFrontmatter(baseContent);
  const local = parseMarkdownWithFrontmatter(localContent);

  // Merge frontmatter (local overrides base, except for 'extends')
  const mergedFrontmatter = { ...base.frontmatter };
  for (const [key, value] of Object.entries(local.frontmatter)) {
    if (key !== 'extends') {
      // Append to description if both have it
      if (key === 'description' && mergedFrontmatter.description) {
        mergedFrontmatter.description = `${mergedFrontmatter.description} ${value}`;
      } else {
        mergedFrontmatter[key] = value;
      }
    }
  }

  // Build merged content
  let merged = '---\n';
  for (const [key, value] of Object.entries(mergedFrontmatter)) {
    merged += `${key}: "${value}"\n`;
  }
  merged += '---\n';

  // Add base body
  merged += base.body;

  // Add separator and local body
  if (local.body.trim()) {
    merged += '\n\n<!-- Local Extensions (from SKILL.local.md) -->\n\n';
    merged += local.body;
  }

  return merged;
}

/**
 * Merge SKILL.local.md files with their base SKILL.md files.
 * This allows companies to extend skills without modifying the base.
 */
async function mergeSkillExtensions(targetDir) {
  const skillsDir = path.join(targetDir, 'skills');

  if (!(await fs.pathExists(skillsDir))) {
    return;
  }

  // Find all SKILL.local.md files
  const localSkillFiles = await glob('*/SKILL.local.md', { cwd: skillsDir, nodir: true });

  for (const localFile of localSkillFiles) {
    const skillName = path.dirname(localFile);
    const baseFile = path.join(skillsDir, skillName, 'SKILL.md');
    const localPath = path.join(skillsDir, localFile);

    if (!(await fs.pathExists(baseFile))) {
      console.log(`  ⚠ No base SKILL.md for ${skillName}, skipping merge`);
      continue;
    }

    const baseContent = await fs.readFile(baseFile, 'utf8');

    // Skip if already merged (contains the marker comment)
    if (baseContent.includes('<!-- Local Extensions (from SKILL.local.md) -->')) {
      continue;
    }

    const localContent = await fs.readFile(localPath, 'utf8');
    const merged = mergeSkillFiles(baseContent, localContent);

    await fs.writeFile(baseFile, merged, 'utf8');
    console.log(`  ✓ Merged: skills/${skillName}/SKILL.md + SKILL.local.md`);
  }
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

async function copyDockerFiles(agentsDir) {
  const dockerSrc = path.join(templateRoot, 'docker');
  if (!(await fs.pathExists(dockerSrc))) {
    return false;
  }

  // Copy docker-compose file to .agents/
  const composeSrc = path.join(dockerSrc, 'docker-compose.graphiti.yml');
  const composeDest = path.join(agentsDir, 'docker-compose.graphiti.yml');
  if (await fs.pathExists(composeSrc)) {
    await fs.copy(composeSrc, composeDest, { overwrite: false });
  }

  // Copy .env to project root (if no .env exists)
  const envSrc = path.join(dockerSrc, '.env');
  const rootEnv = path.join(path.dirname(agentsDir), '.env');
  const envExampleDest = path.join(path.dirname(agentsDir), '.env');
  if (await fs.pathExists(envSrc)) {
    // Always copy the example file for reference
    await fs.copy(envSrc, envExampleDest, { overwrite: false });
    // If no .env exists, create one from the example
    if (!(await fs.pathExists(rootEnv))) {
      await fs.copy(envSrc, rootEnv);
      console.log('  Created .env from .env');
    }
  }

  return true;
}

// ============================================================================
// Init Review - Automatic Codebase Analysis
// ============================================================================

const CODEBASE_INDICATORS = [
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile',
  'composer.json', 'Makefile', 'CMakeLists.txt'
];

/**
 * Check if the project root is a codebase (not just an empty folder)
 */
async function isCodebase() {
  for (const file of CODEBASE_INDICATORS) {
    const filePath = path.join(projectRoot, file);
    if (await fs.pathExists(filePath)) {
      return true;
    }
  }
  // Check for .git or src directory
  if (await fs.pathExists(path.join(projectRoot, '.git'))) return true;
  if (await fs.pathExists(path.join(projectRoot, 'src'))) return true;
  return false;
}

/**
 * Run init-review in the background (doesn't block postinstall)
 */
async function runInitReview(agentsDir) {
  // Skip if user explicitly disabled init-review (useful for CI or large repos)
  if (process.env.LISA_SKIP_INIT_REVIEW === '1' || process.env.LISA_SKIP_INIT_REVIEW === 'true') {
    return;
  }

  const markerPath = path.join(agentsDir, '.init-review-done');

  // Skip if already done
  if (await fs.pathExists(markerPath)) {
    return;
  }

  // Skip if not a codebase
  if (!(await isCodebase())) {
    return;
  }

  const initReviewScript = path.join(agentsDir, 'skills', 'init-review', 'scripts', 'init-review.js');

  // Skip if script doesn't exist (first install, templates not yet copied)
  if (!(await fs.pathExists(initReviewScript))) {
    return;
  }

  console.log('');
  console.log('  Running codebase analysis in background...');

  try {
    // Run init-review in detached background process
    const logFile = path.join(agentsDir, '.init-review.log');
    const logStream = require('fs').createWriteStream(logFile);

    const child = spawn('node', [initReviewScript, 'run'], {
      cwd: projectRoot,
      stdio: ['ignore', logStream, logStream],
      detached: true
    });

    child.unref();

    console.log('  ✓ Init review queued (logs: .agents/.init-review.log)');
  } catch (err) {
    console.log(`  Init review failed: ${err.message}`);
  }
}

async function setupDocker(agentsDir) {
  console.log('');

  // Check if Docker is available
  if (!isDockerAvailable()) {
    console.log('  Docker is not running or not installed.');
    console.log('  To enable memory persistence, install Docker and run:');
    console.log('    docker compose -f .agents/docker-compose.graphiti.yml up -d');
    return;
  }

  if (!isDockerComposeAvailable()) {
    console.log('  Docker Compose is not available.');
    return;
  }

  // Check if lisa container is already running - skip to avoid wiping env vars
  if (isLisaContainerRunning()) {
    console.log('  ✓ Lisa memory stack is already running (container detected)');
    console.log('  Skipping docker compose to preserve existing configuration.');
    return;
  }

  // Ask user if they want to start Docker
  const shouldStart = await askYesNo('Start Graphiti memory stack (requires Docker)?');

  if (!shouldStart) {
    console.log('  Skipping Docker setup. Run later with:');
    console.log('    docker compose -f .agents/docker-compose.graphiti.yml up -d');
    return;
  }

  // Copy Docker files to .agents/
  console.log('  Copying Docker configuration...');
  await copyDockerFiles(agentsDir);

  // Check if .env exists in project root, if not copy from example
  const projectRoot = path.dirname(agentsDir);
  const envFile = path.join(projectRoot, '.env');
  const envExample = path.join(projectRoot, '.env');
  if (!(await fs.pathExists(envFile)) && (await fs.pathExists(envExample))) {
    await fs.copy(envExample, envFile);
    console.log('  Created .env from .env');
    console.log('  IMPORTANT: Edit .env and add your OPENAI_API_KEY');
  }

  // Check for required API key
  const envContent = await fs.pathExists(envFile) ? await fs.readFile(envFile, 'utf8') : '';
  if (!envContent.includes('OPENAI_API_KEY=') || envContent.includes('OPENAI_API_KEY=sk-...')) {
    console.log('');
    console.log('  OPENAI_API_KEY not configured in .env');
    console.log('  Graphiti requires an OpenAI API key for LLM-powered entity extraction.');
    console.log('  Please edit .env and add your key, then run:');
    console.log('    docker compose -f .agents/docker-compose.graphiti.yml up -d');
    return;
  }

  // Check for available ports and update compose file if needed
  const composeFile = path.join(agentsDir, 'docker-compose.graphiti.yml');

  console.log('  Checking port availability...');

  let neo4jBrowserPort = 7474;
  let neo4jBoltPort = 7687;
  let mcpPort = 8010;
  let portsChanged = false;

  // Check Neo4j browser port (7474)
  if (!(await isPortAvailable(7474))) {
    neo4jBrowserPort = await findAvailablePort(7475);
    if (!neo4jBrowserPort) {
      console.log('  Could not find available port for Neo4j browser (tried 7474-7484)');
      console.log('  Please free up a port and try again.');
      return;
    }
    portsChanged = true;
    console.log(`  Port 7474 in use, using ${neo4jBrowserPort} for Neo4j browser`);
  }

  // Check Neo4j bolt port (7687)
  if (!(await isPortAvailable(7687))) {
    neo4jBoltPort = await findAvailablePort(7688);
    if (!neo4jBoltPort) {
      console.log('  Could not find available port for Neo4j bolt (tried 7687-7697)');
      console.log('  Please free up a port and try again.');
      return;
    }
    portsChanged = true;
    console.log(`  Port 7687 in use, using ${neo4jBoltPort} for Neo4j bolt`);
  }

  // Check MCP port (8010)
  if (!(await isPortAvailable(8010))) {
    mcpPort = await findAvailablePort(8011);
    if (!mcpPort) {
      console.log('  Could not find available port for Graphiti MCP (tried 8010-8020)');
      console.log('  Please free up a port and try again.');
      return;
    }
    portsChanged = true;
    console.log(`  Port 8010 in use, using ${mcpPort} for Graphiti MCP`);
  }

  // Update compose file if ports changed
  if (portsChanged) {
    await updateDockerComposePorts(composeFile, neo4jBrowserPort, neo4jBoltPort, mcpPort);

    // Also update .env with the new endpoint
    const envFilePath = path.join(projectRoot, '.env');
    if (await fs.pathExists(envFilePath)) {
      let envContent = await fs.readFile(envFilePath, 'utf8');
      envContent = envContent.replace(
        /GRAPHITI_ENDPOINT=http:\/\/localhost:\d+\/mcp\//,
        `GRAPHITI_ENDPOINT=http://localhost:${mcpPort}/mcp/`
      );
      // If no endpoint exists, add it
      if (!envContent.includes('GRAPHITI_ENDPOINT=')) {
        envContent += `\nGRAPHITI_ENDPOINT=http://localhost:${mcpPort}/mcp/\n`;
      }
      await fs.writeFile(envFilePath, envContent);
    }

    // Also update .agents/skills/.env (where skills actually read config from)
    const skillsEnvPath = path.join(projectRoot, '.agents', 'skills', '.env');
    if (await fs.pathExists(skillsEnvPath)) {
      let skillsEnv = await fs.readFile(skillsEnvPath, 'utf8');
      skillsEnv = skillsEnv.replace(
        /GRAPHITI_ENDPOINT=http:\/\/localhost:\d+\/mcp\//,
        `GRAPHITI_ENDPOINT=http://localhost:${mcpPort}/mcp/`
      );
      // If no endpoint exists, add it
      if (!skillsEnv.includes('GRAPHITI_ENDPOINT=')) {
        skillsEnv += `\nGRAPHITI_ENDPOINT=http://localhost:${mcpPort}/mcp/\n`;
      }
      await fs.writeFile(skillsEnvPath, skillsEnv);
      console.log(`  Updated .agents/skills/.env with port ${mcpPort}`);
    }
  }

  // Start Docker stack in the background
  try {
    runDockerComposeBackground(composeFile, ['up', '-d']);
    console.log('');
    console.log('  Starting Graphiti memory stack in the background...');
    console.log('  (First run may take a few minutes to download images)');
    console.log('');
    console.log('  Check status:  docker ps --filter "name=lisa"');
    console.log('  View logs:     cat .agents/.docker-setup.log');
    console.log('');
    console.log('  Once running:');
    console.log(`    Neo4j Browser: http://localhost:${neo4jBrowserPort}`);
    console.log(`    Neo4j Bolt:    bolt://localhost:${neo4jBoltPort}`);
    console.log(`    Graphiti MCP:  http://localhost:${mcpPort}`);
  } catch (err) {
    console.log(`  Docker startup failed: ${err.message}`);
    console.log('  You can try manually with:');
    console.log('    docker compose -f .agents/docker-compose.graphiti.yml up -d');
  }
}

async function main() {
  // Skip postinstall in development mode (when running npm ci/install in the source repo)
  // Only run when installed as a dependency in another project
  if (!isInstalledAsDependency) {
    // Silent exit in dev mode - this is expected behavior
    return;
  }

  console.log('');
  console.log('lisa: Setting up Claude Code memory and rules...');
  console.log('');

  // Check if templates exist
  if (!(await fs.pathExists(templateRoot))) {
    console.error('  Templates not found. Package may not be built correctly.');
    process.exit(1);
  }

  const agentsDir = path.join(projectRoot, '.agents');
  const claudeDir = path.join(projectRoot, '.claude');

  // Preserve local extensions before copying (user-created .local.md files and .local/ directories)
  const preservedExtensions = await preserveLocalExtensions(agentsDir);

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

  // Restore local extensions after copying
  await restoreLocalExtensions(agentsDir, preservedExtensions);

  // Merge SKILL.local.md extensions with base SKILL.md files
  await mergeSkillExtensions(agentsDir);

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

  // Check if this is a non-npm project (Python, Go, Rust, etc.)
  // If so, move node_modules and package.json to .claude/lib/ to keep project clean
  if (await isNonNpmProject()) {
    console.log('');
    console.log('  Detected non-npm project (Python, Go, Rust, etc.)');
    console.log('  Setting up isolated mode to keep your project clean...');
    await setupIsolatedMode(claudeDir);
  }

  // Init review - automatic codebase analysis (runs in background)
  await runInitReview(agentsDir);

  // Docker setup with interactive prompt
  await setupDocker(agentsDir);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  lisa: Setup complete!');
  console.log('  Claude Code now has automatic memory and coding rules.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

main().catch((err) => {
  console.error('lisa postinstall failed:', err.message);
  // Don't exit with error - allow npm install to complete
});