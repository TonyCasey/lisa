const path = require('path');
const fs = require('fs-extra');

// Copy template *assets* (non-TS) into dist/templates without clobbering the
// compiled JS that tsc already emitted. Also strip any stray .ts/.tsx files
// that might have been left by older builds.
const srcDir = path.join(__dirname, '..', 'src', 'templates');
const outDir = path.join(__dirname, '..', 'dist', 'templates');

async function removeTypeScriptFiles(dir) {
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

// NOTE: Previously attempted to rename .js files to .cjs for ES module compatibility,
// but this caused issues:
// 1. Windows path check failed (forward slash vs backslash)
// 2. Hooks hardcode .js paths and would break after rename
// Skills use CommonJS require() syntax and work correctly as .js files.

async function main() {
  await fs.ensureDir(outDir);
  await removeTypeScriptFiles(outDir);
  await fs.copy(srcDir, outDir, {
    recursive: true,
    filter: (src) => !src.endsWith('.ts') && !src.endsWith('.tsx'),
    overwrite: true,
  });
}

main().catch((err) => {
  console.error('postbuild-copy-templates failed', err);
  process.exit(1);
});
