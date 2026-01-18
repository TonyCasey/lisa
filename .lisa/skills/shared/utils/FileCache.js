"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileCache = createFileCache;
exports.createCacheConfigFromSkill = createCacheConfigFromSkill;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Creates a file-based cache instance.
 */
function createFileCache(config) {
    const cacheDir = config.cacheDir;
    const appendMode = config.appendMode ?? true;
    /**
     * Ensure the cache directory exists.
     */
    function ensureDir() {
        try {
            if (!fs_1.default.existsSync(cacheDir)) {
                fs_1.default.mkdirSync(cacheDir, { recursive: true });
            }
        }
        catch (_err) {
            // Silently fail if we can't create the directory
        }
    }
    return {
        write(key, data) {
            try {
                ensureDir();
                const filePath = path_1.default.join(cacheDir, `${key}.log`);
                const line = JSON.stringify({
                    ts: new Date().toISOString(),
                    ...(data || {}),
                });
                if (appendMode) {
                    fs_1.default.appendFileSync(filePath, `${line}\n`, 'utf8');
                }
                else {
                    fs_1.default.writeFileSync(filePath, `${line}\n`, 'utf8');
                }
            }
            catch (_err) {
                // Cache failures should not crash the application
            }
        },
        read(key) {
            try {
                const filePath = path_1.default.join(cacheDir, `${key}.log`);
                const content = fs_1.default.readFileSync(filePath, 'utf8').trim();
                if (!content)
                    return null;
                // Parse all lines and return as array
                const lines = content.split('\n').filter(Boolean);
                return lines.map((l) => JSON.parse(l));
            }
            catch (_err) {
                return null;
            }
        },
        readLatest(key) {
            try {
                const filePath = path_1.default.join(cacheDir, `${key}.log`);
                const content = fs_1.default.readFileSync(filePath, 'utf8').trim();
                if (!content)
                    return null;
                // Parse the last line only
                const lines = content.split('\n').filter(Boolean);
                if (lines.length === 0)
                    return null;
                return JSON.parse(lines[lines.length - 1]);
            }
            catch (_err) {
                return null;
            }
        },
        getFilePath(key) {
            return path_1.default.join(cacheDir, `${key}.log`);
        },
        clear(key) {
            try {
                const filePath = path_1.default.join(cacheDir, `${key}.log`);
                if (fs_1.default.existsSync(filePath)) {
                    fs_1.default.unlinkSync(filePath);
                }
            }
            catch (_err) {
                // Silently fail
            }
        },
    };
}
/**
 * Creates a cache config for the default .lisa cache directory.
 * @param skillName - Name of the skill (e.g., 'memory', 'tasks')
 */
function createCacheConfigFromSkill(skillName) {
    // Determine .lisa directory by traversing up from current file
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const parent = path_1.default.dirname(dir);
        const baseName = path_1.default.basename(dir);
        if (baseName === '.lisa') {
            return {
                cacheDir: path_1.default.join(dir, 'skills', skillName, 'cache'),
                appendMode: true,
            };
        }
        dir = parent;
    }
    // Fallback: assume .lisa is at project root
    return {
        cacheDir: path_1.default.join(process.cwd(), '.lisa', 'skills', skillName, 'cache'),
        appendMode: true,
    };
}
//# sourceMappingURL=FileCache.js.map