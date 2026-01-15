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

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: object, body: string }
 */
function parseMarkdownWithFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  // Simple YAML parsing for frontmatter (handles basic key: value pairs)
  const frontmatter = {};
  const yamlLines = match[1].split('\n');
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
    const localContent = await fs.readFile(localPath, 'utf8');

    const merged = mergeSkillFiles(baseContent, localContent);

    await fs.writeFile(baseFile, merged, 'utf8');
    console.log(`  ✓ Merged: skills/${skillName}/SKILL.md + SKILL.local.md`);
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

  // Merge SKILL.local.md extensions with base SKILL.md files
  await mergeSkillExtensions(targetAgents);

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
