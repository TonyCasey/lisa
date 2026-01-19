const path = require('path');
const fs = require('fs-extra');
const { glob } = require('glob');

// New structure: dist/project/.lisa/, dist/project/.claude/, dist/project/.opencode/
const distProject = path.resolve(__dirname, '..', 'dist', 'project');

// Lisa templates (skills, rules)
const distLisa = path.join(distProject, '.lisa');
const distLisaSkills = path.join(distLisa, 'skills');
const distLisaRules = path.join(distLisa, 'rules');
const targetLisa = path.resolve(__dirname, '..', '.lisa');

// Legacy paths (for backward compatibility)
const distLegacyAgents = path.resolve(__dirname, '..', 'dist', 'templates', 'agents');
const distLegacyRules = path.resolve(__dirname, '..', 'dist', 'templates', 'rules');

// Claude Code templates (hooks)
const distClaude = path.join(distProject, '.claude');
const distLegacyClaude = path.resolve(__dirname, '..', 'dist', 'templates', 'claude');
const distBundledHooks = path.resolve(__dirname, '..', 'dist', 'hooks');
const targetClaude = path.resolve(__dirname, '..', '.claude');

// OpenCode templates (plugin)
const distOpenCode = path.join(distProject, '.opencode');
const distOpenCodePlugin = path.resolve(__dirname, '..', 'dist', 'opencode');
const targetOpenCode = path.resolve(__dirname, '..', '.opencode');

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

/**
 * Track directories that were copied instead of linked.
 * Used by `lisa sync` to keep copies up to date.
 */
async function recordCopyFallback(projectRoot, link, target) {
  const fallbackFile = path.join(projectRoot, '.lisa', '.copy-fallbacks.json');
  let existing = { copies: [] };
  
  try {
    if (await fs.pathExists(fallbackFile)) {
      existing = await fs.readJson(fallbackFile);
    }
  } catch {
    // Start fresh if file is corrupted
  }
  
  // Check if already recorded
  const alreadyRecorded = existing.copies.some(c => c.link === link);
  if (!alreadyRecorded) {
    existing.copies.push({ link, target, createdAt: new Date().toISOString() });
    await fs.writeJson(fallbackFile, existing, { spaces: 2 });
  }
}

/**
 * Create symlink with Windows fallback.
 * On Windows, tries junction first, then falls back to directory copy.
 */
async function createSymlink(target, linkPath, projectRoot) {
  const isWindows = process.platform === 'win32';
  
  try {
    // Remove existing symlink/junction/directory if present
    if (await fs.pathExists(linkPath)) {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        await fs.remove(linkPath);
      } else if (stat.isDirectory()) {
        // Check if it's a junction on Windows
        if (isWindows) {
          try {
            await fs.remove(linkPath);
          } catch {
            // Directory might be in use, skip
            return { success: false, method: 'skip' };
          }
        } else {
          // On Unix, a real directory shouldn't be overwritten
          return { success: false, method: 'skip' };
        }
      }
    }
    
    await fs.ensureDir(path.dirname(linkPath));
    
    if (isWindows) {
      // Try junction first (doesn't require admin on Windows)
      try {
        await fs.symlink(target, linkPath, 'junction');
        return { success: true, method: 'junction' };
      } catch (junctionErr) {
        // Junction failed, try symlink
        try {
          await fs.symlink(target, linkPath, 'dir');
          return { success: true, method: 'symlink' };
        } catch (symlinkErr) {
          // Both failed, fall back to copy
          const absoluteTarget = path.resolve(path.dirname(linkPath), target);
          if (await fs.pathExists(absoluteTarget)) {
            await fs.copy(absoluteTarget, linkPath);
            // Record for future sync
            if (projectRoot) {
              const relativeLinkPath = path.relative(projectRoot, linkPath);
              await recordCopyFallback(projectRoot, relativeLinkPath, target);
            }
            console.log(`  (copy fallback: ${linkPath})`);
            return { success: true, method: 'copy' };
          }
          return { success: false, method: 'failed' };
        }
      }
    } else {
      // Unix: standard symlink
      await fs.symlink(target, linkPath, 'dir');
      return { success: true, method: 'symlink' };
    }
  } catch (err) {
    console.error(`Failed to create link ${linkPath}: ${err.message}`);
    return { success: false, method: 'error' };
  }
}

async function main() {
  // Determine which source to use: new structure (dist/project/.lisa) or legacy (dist/templates/agents)
  const useNewStructure = await fs.pathExists(distLisa);
  const useLegacy = !useNewStructure && await fs.pathExists(distLegacyAgents);

  if (!useNewStructure && !useLegacy) {
    throw new Error(`No templates found. Checked:\n  - ${distLisa}\n  - ${distLegacyAgents}\nRun build first.`);
  }

  const sourceLisa = useNewStructure ? distLisa : distLegacyAgents;
  const sourceRules = useNewStructure ? distLisaRules : distLegacyRules;
  const sourceClaude = useNewStructure ? distClaude : distLegacyClaude;

  // Preserve local extensions before overwriting
  const preservedAgents = await preserveLocalExtensions(targetLisa);

  // Preserve .env file before cleaning
  const envPath = path.join(targetLisa, '.env');
  let preservedEnv = null;
  if (await fs.pathExists(envPath)) {
    preservedEnv = await fs.readFile(envPath, 'utf8');
  }

  // Clean target directories for fresh deploy (development mode)
  console.log('Cleaning target directories...');
  await fs.remove(targetLisa);
  await fs.remove(targetClaude);
  await fs.remove(targetOpenCode);

  // Restore .env file after cleaning
  if (preservedEnv) {
    await fs.ensureDir(targetLisa);
    await fs.writeFile(envPath, preservedEnv, 'utf8');
    console.log('  ✓ Restored: .lisa/.env');
  }

  // Filter to exclude sourcemaps and declaration maps from deployment
  const deployFilter = (src) => {
    const basename = path.basename(src);
    // Exclude .map, .d.ts.map, and .d.ts files (keep only .js and other assets)
    if (basename.endsWith('.js.map') || basename.endsWith('.d.ts.map') || basename.endsWith('.d.ts')) {
      return false;
    }
    return true;
  };

  // Deploy .lisa templates (skills)
  await fs.ensureDir(targetLisa);
  if (useNewStructure && await fs.pathExists(distLisaSkills)) {
    await fs.copy(distLisaSkills, path.join(targetLisa, 'skills'), { overwrite: true, errorOnExist: false, filter: deployFilter });
    console.log(`Deployed skills to ${path.join(targetLisa, 'skills')}`);
  } else {
    await fs.copy(sourceLisa, targetLisa, { overwrite: true, errorOnExist: false, filter: deployFilter });
    console.log(`Deployed lisa templates to ${targetLisa}`);
  }

  // Deploy rules templates
  if (await fs.pathExists(sourceRules)) {
    await fs.copy(sourceRules, path.join(targetLisa, 'rules'), { overwrite: true, errorOnExist: false, filter: deployFilter });
    console.log(`Deployed rules templates to ${path.join(targetLisa, 'rules')}`);
  }

  // Note: The DEPLOY_AGENTS_LOCAL block was removed as it referenced an undefined
  // variable (distBuiltLisa) and the local build workflow now uses the standard
  // dist/project/.lisa path which is already handled above.

  // Restore local extensions after deployment
  await restoreLocalExtensions(targetLisa, preservedAgents);

  // Merge SKILL.local.md extensions with base SKILL.md files
  await mergeSkillExtensions(targetLisa);

  // Deploy Claude Code templates (hooks)
  if (await fs.pathExists(distClaude)) {
    await fs.ensureDir(targetClaude);
    await fs.copy(distClaude, targetClaude, { overwrite: true, errorOnExist: false });
    console.log(`Deployed Claude templates to ${targetClaude}`);
  } else {
    console.log(`No Claude templates found at ${distClaude}; skipping.`);
  }

  // Deploy bundled hooks (new architecture) if available
  // These override the template hooks with the clean architecture version
  if (await fs.pathExists(distBundledHooks)) {
    const targetHooks = path.join(targetClaude, 'hooks');
    await fs.ensureDir(targetHooks);
    await fs.copy(distBundledHooks, targetHooks, { overwrite: true, errorOnExist: false });
    console.log(`Deployed bundled hooks to ${targetHooks}`);
  }

  // Create symlinks: .claude/rules -> ../.lisa/rules, .claude/skills -> ../.lisa/skills
  const projectRoot = path.resolve(__dirname, '..');
  const rulesSymlink = path.join(targetClaude, 'rules');
  const skillsSymlink = path.join(targetClaude, 'skills');

  const rulesResult = await createSymlink('../.lisa/rules', rulesSymlink, projectRoot);
  if (rulesResult.success) {
    console.log(`Created ${rulesResult.method}: .claude/rules -> ../.lisa/rules`);
  }

  const skillsResult = await createSymlink('../.lisa/skills', skillsSymlink, projectRoot);
  if (skillsResult.success) {
    console.log(`Created ${skillsResult.method}: .claude/skills -> ../.lisa/skills`);
  }

  // Deploy OpenCode plugin if bundled
  if (await fs.pathExists(distOpenCodePlugin)) {
    const targetPlugin = path.join(targetOpenCode, 'plugin');
    await fs.ensureDir(targetPlugin);
    await fs.copy(distOpenCodePlugin, targetPlugin, { overwrite: true, errorOnExist: false });
    console.log(`Deployed OpenCode plugin to ${targetPlugin}`);

    // Create symlinks for OpenCode: .opencode/skills -> ../.lisa/skills
    const opencodeSkillSymlink = path.join(targetOpenCode, 'skills');
    const opencodeSkillResult = await createSymlink('../.lisa/skills', opencodeSkillSymlink, projectRoot);
    if (opencodeSkillResult.success) {
      console.log(`Created ${opencodeSkillResult.method}: .opencode/skills -> ../.lisa/skills`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
