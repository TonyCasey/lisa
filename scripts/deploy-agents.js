const path = require('path');
const fs = require('fs-extra');
const { glob } = require('glob');

// Agents templates (skill scripts, etc.)
const distAgents = path.resolve(__dirname, '..', 'dist', 'templates', 'agents');
const distRules = path.resolve(__dirname, '..', 'dist', 'templates', 'rules');
const targetAgents = path.resolve(__dirname, '..', '.agents');
const distBuiltAgents = path.resolve(__dirname, '..', 'dist', 'agents'); // fully built agents (only for local dev)

// Claude Code templates (hooks)
const distClaude = path.resolve(__dirname, '..', 'dist', 'templates', 'claude');
const targetClaude = path.resolve(__dirname, '..', '.claude');

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
  const localDirs = await glob('**/*.local', { cwd: targetDir, onlyDirectories: true });
  for (const dir of localDirs) {
    const fullPath = path.join(targetDir, dir);
    const files = [];
    // Recursively read all files in the directory
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
  // Restore .local.md files
  for (const { path: filePath, content } of preserved.files) {
    const fullPath = path.join(targetDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf8');
    console.log(`  ✓ Restored: ${filePath}`);
  }

  // Restore .local directories
  for (const { path: dirPath, files } of preserved.dirs) {
    for (const { path: filePath, content } of files) {
      const fullPath = path.join(targetDir, dirPath, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
    }
    console.log(`  ✓ Restored: ${dirPath}/`);
  }
}

async function createSymlink(target, linkPath) {
  try {
    // Remove existing symlink if present
    if (await fs.pathExists(linkPath)) {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        await fs.remove(linkPath);
      } else {
        // Not a symlink, skip
        return false;
      }
    }
    await fs.ensureDir(path.dirname(linkPath));
    await fs.symlink(target, linkPath, 'dir');
    return true;
  } catch (err) {
    console.error(`Failed to create symlink ${linkPath}: ${err.message}`);
    return false;
  }
}

async function main() {
  // Deploy agents templates (skills)
  if (!(await fs.pathExists(distAgents))) {
    throw new Error(`dist agents templates not found at ${distAgents}; run build first.`);
  }

  // Preserve local extensions before overwriting
  const preservedAgents = await preserveLocalExtensions(targetAgents);

  await fs.ensureDir(targetAgents);
  await fs.copy(distAgents, targetAgents, { overwrite: true, errorOnExist: false });
  console.log(`Deployed agents templates to ${targetAgents}`);

  // Deploy rules templates
  if (await fs.pathExists(distRules)) {
    await fs.copy(distRules, path.join(targetAgents, 'rules'), { overwrite: true, errorOnExist: false });
    console.log(`Deployed rules templates to ${path.join(targetAgents, 'rules')}`);
  }

  // When running a local build (`npm run build:local`), also copy the already-built
  // agents bundle (if present) into .agents for immediate use.
  if (process.env.DEPLOY_AGENTS_LOCAL === '1' && (await fs.pathExists(distBuiltAgents))) {
    await fs.copy(distBuiltAgents, targetAgents, { overwrite: true, errorOnExist: false });
    console.log(`Copied built agents from ${distBuiltAgents} to ${targetAgents} (local build).`);
  }

  // Restore local extensions after deployment
  await restoreLocalExtensions(targetAgents, preservedAgents);

  // Deploy Claude Code templates (hooks)
  if (await fs.pathExists(distClaude)) {
    await fs.ensureDir(targetClaude);
    await fs.copy(distClaude, targetClaude, { overwrite: true, errorOnExist: false });
    console.log(`Deployed Claude templates to ${targetClaude}`);
  } else {
    console.log(`No Claude templates found at ${distClaude}; skipping.`);
  }

  // Create symlinks: .claude/rules -> ../.agents/rules, .claude/skills -> ../.agents/skills
  const rulesSymlink = path.join(targetClaude, 'rules');
  const skillsSymlink = path.join(targetClaude, 'skills');

  if (await createSymlink('../.agents/rules', rulesSymlink)) {
    console.log(`Created symlink .claude/rules -> ../.agents/rules`);
  }

  if (await createSymlink('../.agents/skills', skillsSymlink)) {
    console.log(`Created symlink .claude/skills -> ../.agents/skills`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
