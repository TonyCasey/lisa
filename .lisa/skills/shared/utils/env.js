"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
exports.isZepCloudConfigured = isZepCloudConfigured;
exports.isNeo4jConfigured = isNeo4jConfigured;
exports.isLocalMcpConfigured = isLocalMcpConfigured;
/**
 * Environment configuration utilities.
 * Loads configuration from .lisa/.env and process.env.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Get the .lisa directory path by traversing up from current file.
 */
function getLisaDir() {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const parent = path_1.default.dirname(dir);
        const baseName = path_1.default.basename(dir);
        if (baseName === '.lisa') {
            return dir;
        }
        if (path_1.default.basename(parent) === '.lisa') {
            return parent;
        }
        dir = parent;
    }
    // Fallback: assume .lisa is at project root
    return path_1.default.join(process.cwd(), '.lisa');
}
/**
 * Read .env file and return key-value pairs.
 */
function readEnvFile(envPath) {
    const env = {};
    try {
        const raw = fs_1.default.readFileSync(envPath, 'utf8');
        raw.split(/\r?\n/).forEach((line) => {
            if (!line || line.startsWith('#'))
                return;
            const idx = line.indexOf('=');
            if (idx === -1)
                return;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            env[key] = val;
        });
    }
    catch {
        // .env file is optional
    }
    return env;
}
/**
 * Load environment configuration.
 * Merges .lisa/.env with process.env (process.env takes precedence).
 */
function loadEnv() {
    const lisaDir = getLisaDir();
    const envPath = path_1.default.join(lisaDir, '.env');
    const fileEnv = readEnvFile(envPath);
    // Helper to get value with fallback
    const get = (key, fallback = '') => process.env[key] || fileEnv[key] || fallback;
    const storageMode = get('STORAGE_MODE', 'local');
    return {
        STORAGE_MODE: storageMode,
        GRAPHITI_ENDPOINT: get('GRAPHITI_ENDPOINT', 'http://localhost:8010/mcp/'),
        GRAPHITI_GROUP_ID: get('GRAPHITI_GROUP_ID') || undefined,
        NEO4J_URI: get('NEO4J_URI', 'bolt://localhost:7687'),
        NEO4J_USER: get('NEO4J_USER', 'neo4j'),
        NEO4J_PASSWORD: get('NEO4J_PASSWORD', 'demodemo'),
        NEO4J_DATABASE: get('NEO4J_DATABASE', 'neo4j'),
        ZEP_API_KEY: get('ZEP_API_KEY') || undefined,
        ZEP_BASE_URL: get('ZEP_BASE_URL') || undefined,
        LOG_LEVEL: get('LOG_LEVEL', 'error'),
        LOG_DIR: get('LOG_DIR') || undefined,
        LOG_CONSOLE: get('LOG_CONSOLE', 'false').toLowerCase() === 'true',
        raw: { ...fileEnv, ...process.env },
    };
}
/**
 * Check if Zep Cloud mode is configured and has required settings.
 */
function isZepCloudConfigured(env) {
    return env.STORAGE_MODE === 'zep-cloud' && !!env.ZEP_API_KEY;
}
/**
 * Check if Neo4j direct mode is configured.
 */
function isNeo4jConfigured(env) {
    return env.STORAGE_MODE === 'neo4j';
}
/**
 * Check if local MCP mode is configured (default).
 */
function isLocalMcpConfigured(env) {
    return env.STORAGE_MODE === 'local';
}
//# sourceMappingURL=env.js.map