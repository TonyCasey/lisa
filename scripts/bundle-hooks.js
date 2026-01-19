#!/usr/bin/env node
/**
 * Bundle CLI adapters using esbuild.
 * 
 * This creates self-contained files that include all dependencies,
 * allowing them to run directly without needing access to the full dist/ tree.
 * 
 * Bundles:
 * - Claude Code hooks (session-start, session-stop, user-prompt-submit)
 * - OpenCode plugin (lisa.js)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// Claude Code hooks (now in src/lib/infrastructure/adapters/claude/)
const claudeSrcDir = path.resolve(__dirname, '..', 'src', 'lib', 'infrastructure', 'adapters', 'claude');
const hooksOutDir = path.resolve(__dirname, '..', 'dist', 'hooks');

const hooks = [
  'session-start.ts',
  'session-stop.ts',
  'user-prompt-submit.ts',
];

// OpenCode plugin (now in src/lib/infrastructure/adapters/opencode/)
const opencodeSrcDir = path.resolve(__dirname, '..', 'src', 'lib', 'infrastructure', 'adapters', 'opencode');
const opencodeOutDir = path.resolve(__dirname, '..', 'dist', 'opencode');

// Skill scripts (src/project/.lisa/skills/*/scripts/*.ts)
const skillsSrcDir = path.resolve(__dirname, '..', 'src', 'project', '.lisa', 'skills');
const skillsOutDir = path.resolve(__dirname, '..', 'dist', 'project', '.lisa', 'skills');

/**
 * Bundle a TypeScript file using esbuild.
 */
async function bundleFile(entryPoint, outFile, addShebang = false) {
  if (!await fs.pathExists(entryPoint)) {
    console.log(`  Skipping (not found): ${entryPoint}`);
    return false;
  }

  try {
    execSync(
      `npx esbuild "${entryPoint}" --bundle --platform=node --target=node18 --outfile="${outFile}" --format=cjs`,
      { stdio: 'inherit' }
    );

    if (addShebang) {
      const content = await fs.readFile(outFile, 'utf8');
      if (!content.startsWith('#!/usr/bin/env node')) {
        await fs.writeFile(outFile, '#!/usr/bin/env node\n' + content);
      }
    }

    console.log(`  ✓ ${outFile}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to bundle: ${err.message}`);
    return false;
  }
}

async function bundleClaudeHooks() {
  console.log('Bundling Claude Code hooks...');
  await fs.ensureDir(hooksOutDir);

  for (const hook of hooks) {
    const entryPoint = path.join(claudeSrcDir, hook);
    const outFile = path.join(hooksOutDir, hook.replace('.ts', '.js'));
    console.log(`  ${hook}...`);
    await bundleFile(entryPoint, outFile, true);
  }
}

async function bundleOpenCodePlugin() {
  console.log('Bundling OpenCode plugin...');
  await fs.ensureDir(opencodeOutDir);

  const entryPoint = path.join(opencodeSrcDir, 'plugin.ts');
  const outFile = path.join(opencodeOutDir, 'lisa.js');
  console.log('  plugin.ts -> lisa.js...');
  await bundleFile(entryPoint, outFile, false);
}

async function main() {
  await bundleClaudeHooks();
  await bundleOpenCodePlugin();
  console.log('Done bundling.');
}

main().catch(err => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
