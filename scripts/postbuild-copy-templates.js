const path = require('path');
const fs = require('fs-extra');

/**
 * Post-build script to:
 * 1. Copy non-TypeScript assets from src/project/ to dist/project/
 * 2. Remove any stray .ts files that shouldn't be in dist
 * 
 * TypeScript compiles .ts -> .js, but we need to copy:
 * - Markdown files (rules, SKILL.md)
 * - JSON files (settings.json)
 * - Shell scripts
 * - Other non-TS assets
 */

const srcDir = path.join(__dirname, '..', 'src', 'project');
const outDir = path.join(__dirname, '..', 'dist', 'project');

// Also handle legacy templates for backward compatibility
const legacySrcDir = path.join(__dirname, '..', 'src', 'templates');
const legacyOutDir = path.join(__dirname, '..', 'dist', 'templates');

async function removeTypeScriptFiles(dir) {
  if (!(await fs.pathExists(dir))) return;
  
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeTypeScriptFiles(full);
      return;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      await fs.remove(full);
    }
  }));
}

/**
 * Remove empty directories recursively (bottom-up)
 */
async function removeEmptyDirs(dir) {
  if (!(await fs.pathExists(dir))) return;
  
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  // First, recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirs(path.join(dir, entry.name));
    }
  }
  
  // Re-read after potential subdirectory removal
  const remaining = await fs.readdir(dir);
  if (remaining.length === 0) {
    await fs.remove(dir);
  }
}

/**
 * Remove the hooks/utils directory from dist/project/.claude/hooks/
 * since hooks are bundled and don't need the utils folder
 */
async function removeHooksUtils(projectDir) {
  const hooksUtilsDir = path.join(projectDir, '.claude', 'hooks', 'utils');
  if (await fs.pathExists(hooksUtilsDir)) {
    await fs.remove(hooksUtilsDir);
    console.log('  Removed hooks/utils (bundled into hooks)');
  }
}

async function copyNonTsFiles(src, dest) {
  if (!(await fs.pathExists(src))) return;
  
  await fs.ensureDir(dest);
  await fs.copy(src, dest, {
    recursive: true,
    filter: (srcPath) => !srcPath.endsWith('.ts') && !srcPath.endsWith('.tsx'),
    overwrite: true,
  });
}

async function main() {
  // Handle new structure: src/project/ -> dist/project/
  if (await fs.pathExists(srcDir)) {
    console.log('Copying non-TS assets from src/project/ to dist/project/...');
    await fs.ensureDir(outDir);
    await removeTypeScriptFiles(outDir);
    await copyNonTsFiles(srcDir, outDir);
    // Remove hooks/utils since hooks are bundled
    await removeHooksUtils(outDir);
    // Clean up any empty directories left behind
    await removeEmptyDirs(outDir);
    console.log('  Done.');
  }
  
  // Handle legacy structure: src/templates/ -> dist/templates/
  if (await fs.pathExists(legacySrcDir)) {
    console.log('Copying non-TS assets from src/templates/ to dist/templates/...');
    await fs.ensureDir(legacyOutDir);
    await removeTypeScriptFiles(legacyOutDir);
    await copyNonTsFiles(legacySrcDir, legacyOutDir);
    console.log('  Done.');
  }
}

main().catch((err) => {
  console.error('postbuild-copy-templates failed', err);
  process.exit(1);
});
