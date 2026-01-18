/**
 * Version service - handles semver version bumping for package.json.
 */
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type BumpType = 'major' | 'minor' | 'patch';

export interface IParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

export interface IBumpResult {
  status: 'ok';
  bumpType: BumpType;
  oldVersion: string;
  newVersion: string;
  file: string;
}

export interface IVersionService {
  /**
   * Find package.json starting from a directory.
   */
  findPackageJson(startDir?: string): string | null;

  /**
   * Parse a semver version string.
   */
  parseVersion(version: string): IParsedVersion;

  /**
   * Bump a version string.
   */
  bumpVersion(version: string, type: BumpType): string;

  /**
   * Validate bump type argument.
   */
  validateBumpType(arg: string): BumpType;

  /**
   * Execute the version bump.
   */
  bump(bumpType: BumpType, startDir?: string): IBumpResult;
}

/**
 * Creates a version service instance.
 */
export function createVersionService(): IVersionService {
  return {
    findPackageJson(startDir: string = process.cwd()): string | null {
      let dir = startDir;
      while (dir !== path.parse(dir).root) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          return pkgPath;
        }
        dir = path.dirname(dir);
      }
      return null;
    },

    parseVersion(version: string): IParsedVersion {
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
    },

    bumpVersion(version: string, type: BumpType = 'minor'): string {
      const parsed = this.parseVersion(version);

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
      }

      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    },

    validateBumpType(arg: string): BumpType {
      if (arg === 'major' || arg === 'minor' || arg === 'patch') {
        return arg;
      }
      throw new Error(`Invalid bump type "${arg}". Use: major, minor, or patch`);
    },

    bump(bumpType: BumpType, startDir?: string): IBumpResult {
      const pkgPath = this.findPackageJson(startDir);
      if (!pkgPath) {
        throw new Error('package.json not found');
      }

      const pkgContent = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);

      if (!pkg.version) {
        throw new Error('No version field in package.json');
      }

      const oldVersion: string = pkg.version;
      const newVersion = this.bumpVersion(oldVersion, bumpType);

      pkg.version = newVersion;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

      return {
        status: 'ok',
        bumpType,
        oldVersion,
        newVersion,
        file: pkgPath,
      };
    },
  };
}
