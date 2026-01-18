"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVersionService = createVersionService;
/**
 * Version service - handles semver version bumping for package.json.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Creates a version service instance.
 */
function createVersionService() {
    return {
        findPackageJson(startDir = process.cwd()) {
            let dir = startDir;
            while (dir !== path_1.default.parse(dir).root) {
                const pkgPath = path_1.default.join(dir, 'package.json');
                if (fs_1.default.existsSync(pkgPath)) {
                    return pkgPath;
                }
                dir = path_1.default.dirname(dir);
            }
            return null;
        },
        parseVersion(version) {
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
        bumpVersion(version, type = 'minor') {
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
        validateBumpType(arg) {
            if (arg === 'major' || arg === 'minor' || arg === 'patch') {
                return arg;
            }
            throw new Error(`Invalid bump type "${arg}". Use: major, minor, or patch`);
        },
        bump(bumpType, startDir) {
            const pkgPath = this.findPackageJson(startDir);
            if (!pkgPath) {
                throw new Error('package.json not found');
            }
            const pkgContent = fs_1.default.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(pkgContent);
            if (!pkg.version) {
                throw new Error('No version field in package.json');
            }
            const oldVersion = pkg.version;
            const newVersion = this.bumpVersion(oldVersion, bumpType);
            pkg.version = newVersion;
            fs_1.default.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
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
//# sourceMappingURL=VersionService.js.map