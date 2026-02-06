#!/usr/bin/env node
/**
 * Version Bump CLI - thin entry point.
 *
 * Usage: node bump-version.js [major|minor|patch]
 * Default: minor
 *
 * Set LISA_AUTO_BUMP_VERSION in .lisa/.env to control behavior:
 *   true          — enabled (default)
 *   false         — disabled, skip with message
 *   patch|minor|major — enabled with that bump type as default
 */

export {};

async function main(): Promise<void> {
  const { createVersionService } = await import('../shared/services');
  const { loadEnv } = await import('../shared/utils/env');

  const env = loadEnv();
  const autoBump = env.raw['LISA_AUTO_BUMP_VERSION'] ?? 'true';

  // Check if version bumping is disabled
  if (autoBump.toLowerCase() === 'false') {
    const result = { status: 'skipped', reason: 'LISA_AUTO_BUMP_VERSION is false' };
    console.log(JSON.stringify(result));
    console.error('Version bump skipped (LISA_AUTO_BUMP_VERSION=false)');
    return;
  }

  const service = createVersionService();

  try {
    // Resolve bump type: CLI arg > env default > 'minor'
    const explicitArg = process.argv[2];
    let defaultType = 'minor';
    if (['major', 'minor', 'patch'].includes(autoBump.toLowerCase())) {
      defaultType = autoBump.toLowerCase();
    }

    const bumpType = service.validateBumpType(explicitArg || defaultType);
    const result = service.bump(bumpType);

    console.log(JSON.stringify(result));
    console.error(`Bumped version: ${result.oldVersion} → ${result.newVersion} (${result.bumpType})`);
  } catch (err: unknown) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
