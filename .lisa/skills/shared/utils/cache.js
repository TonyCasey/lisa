"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nullCache = void 0;
exports.createCache = createCache;
exports.createCacheConfig = createCacheConfig;
/**
 * File-based cache utilities for skill scripts.
 * Provides simple write-ahead logging for fallback on errors.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Creates a file-based cache instance.
 *
 * @param config - Cache configuration
 * @returns Cache instance
 */
function createCache(config) {
    const cacheFile = path_1.default.join(config.cacheDir, config.filename);
    return {
        write(data) {
            try {
                // Ensure cache directory exists
                const dir = path_1.default.dirname(cacheFile);
                if (!fs_1.default.existsSync(dir)) {
                    fs_1.default.mkdirSync(dir, { recursive: true });
                }
                const line = JSON.stringify({ ts: new Date().toISOString(), ...data });
                fs_1.default.appendFileSync(cacheFile, `${line}\n`, 'utf8');
            }
            catch {
                // Ignore cache write errors - cache is optional
            }
        },
        readFallback() {
            try {
                const data = fs_1.default.readFileSync(cacheFile, 'utf8').trim().split('\n').filter(Boolean);
                if (!data.length)
                    return null;
                return JSON.parse(data[data.length - 1]);
            }
            catch {
                return null;
            }
        },
    };
}
/**
 * Creates a cache config for a skill script.
 * Cache files are stored in the skill's cache/ directory.
 *
 * @param scriptDir - __dirname of the script (e.g., tasks/scripts/)
 * @param filename - Cache filename (e.g., 'tasks.log')
 * @returns Cache configuration
 */
function createCacheConfig(scriptDir, filename) {
    return {
        cacheDir: path_1.default.join(scriptDir, '..', 'cache'),
        filename,
    };
}
/**
 * No-op cache implementation for when caching is disabled.
 */
exports.nullCache = {
    write() {
        // No-op
    },
    readFallback() {
        return null;
    },
};
//# sourceMappingURL=cache.js.map