#!/usr/bin/env node
/**
 * Version Bump CLI - thin entry point.
 *
 * Usage: node bump-version.js [major|minor|patch]
 * Default: minor
 */

export {};

async function main(): Promise<void> {
  const { createVersionService } = await import('../shared/services');

  const service = createVersionService();

  try {
    const bumpType = service.validateBumpType(process.argv[2] || 'minor');
    const result = service.bump(bumpType);

    console.log(JSON.stringify(result));
    console.error(`Bumped version: ${result.oldVersion} → ${result.newVersion} (${result.bumpType})`);
  } catch (err: unknown) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
