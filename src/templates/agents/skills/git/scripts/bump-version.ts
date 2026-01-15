#!/usr/bin/env node
/**
 * Version Bump Script
 *
 * Bumps version in package.json based on semver rules.
 * Usage: node bump-version.js [major|minor|patch]
 *
 * Default: minor
 */

export {}; // ensure module scope to prevent global collisions across templates

const fs = require('fs');
const path = require('path');

type BumpType = 'major' | 'minor' | 'patch';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

interface BumpResult {
  status: 'ok' | 'error';
  bumpType: BumpType;
  oldVersion: string;
  newVersion: string;
  file: string;
}

/**
 * Find package.json in current directory or parent directories
 */
function findPackageJson(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Parse semver version string
 */
function parseVersion(version: string): ParsedVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  };
}

/**
 * Bump version based on type
 */
function bumpVersion(version: string, type: BumpType = 'minor'): string {
  const parsed = parseVersion(version);

  switch (type) {
    case 'major':
      parsed.major += 1;
      parsed.minor = 0;
      parsed.patch = 0;
      break;
    case 'minor':
      parsed.minor += 1;
      parsed.patch = 0;
      break;
    case 'patch':
      parsed.patch += 1;
      break;
    default:
      throw new Error(`Unknown bump type: ${type}. Use major, minor, or patch.`);
  }

  // Drop prerelease suffix on bump
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * Validate bump type argument
 */
function validateBumpType(arg: string): BumpType {
  if (arg === 'major' || arg === 'minor' || arg === 'patch') {
    return arg;
  }
  throw new Error(`Invalid bump type "${arg}". Use: major, minor, or patch`);
}

async function main(): Promise<void> {
  const bumpType = validateBumpType(process.argv[2] || 'minor');

  // Find package.json
  const pkgPath = findPackageJson();
  if (!pkgPath) {
    console.error('Error: package.json not found');
    process.exit(1);
  }

  // Read and parse package.json
  const pkgContent = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgContent);

  if (!pkg.version) {
    console.error('Error: No version field in package.json');
    process.exit(1);
  }

  const oldVersion: string = pkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);

  // Update package.json
  pkg.version = newVersion;

  // Write back with same formatting (2-space indent)
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // Output for scripting (JSON to stdout)
  const result: BumpResult = {
    status: 'ok',
    bumpType,
    oldVersion,
    newVersion,
    file: pkgPath,
  };
  console.log(JSON.stringify(result));

  // Also output human-readable to stderr
  console.error(`Bumped version: ${oldVersion} → ${newVersion} (${bumpType})`);
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
