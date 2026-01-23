#!/usr/bin/env node
/**
 * Bundle OpenCode plugin using esbuild.
 * 
 * Creates a self-contained lisa.js that includes all dependencies,
 * allowing it to run directly in OpenCode without needing the full dist/ tree.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// OpenCode plugin source
const opencodeSrcDir = path.resolve(__dirname, '..', 'src', 'lib', 'infrastructure', 'adapters', 'opencode');
const opencodeOutDir = path.resolve(__dirname, '..', 'dist', 'opencode');

// Packages to mark as external (not bundled, must be available at runtime)
const EXTERNAL_PACKAGES = ['neo4j-driver'];

/**
 * Bundle a TypeScript file using esbuild.
 */
async function bundleFile(entryPoint, outFile, external = []) {
  if (!await fs.pathExists(entryPoint)) {
    console.log(`  Skipping (not found): ${entryPoint}`);
    return false;
  }

  try {
    const allExternal = [...EXTERNAL_PACKAGES, ...external];
    const externalFlags = allExternal.map(pkg => `--external:${pkg}`).join(' ');
    
    execSync(
      `npx esbuild "${entryPoint}" --bundle --platform=node --target=node18 --outfile="${outFile}" --format=cjs ${externalFlags}`,
      { stdio: 'inherit' }
    );

    console.log(`  ✓ ${outFile}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to bundle: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('Bundling OpenCode plugin...');
  await fs.ensureDir(opencodeOutDir);

  const entryPoint = path.join(opencodeSrcDir, 'plugin.ts');
  const outFile = path.join(opencodeOutDir, 'lisa.js');
  
  await bundleFile(entryPoint, outFile);
}

main().catch((err) => {
  console.error('bundle-opencode failed:', err);
  process.exit(1);
});
