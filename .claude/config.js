"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('path');
const fs = require('fs');
// Load .env from .agents/.env if present
const envPath = path.join(process.cwd(), '.agents', '.env');
const env = {};
try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
        if (!line || line.startsWith('#'))
            return;
        const idx = line.indexOf('=');
        if (idx === -1)
            return;
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
}
catch (_) {
    /* optional */
}
const PROJECT_ROOT = process.cwd();
const PROMPT_SKILL_PATH = path.join(PROJECT_ROOT, '.agents/skills/prompt/scripts/prompt.js');
const DEV_DIR = path.join(PROJECT_ROOT, '.dev');
const MCP_ENDPOINT = env.GRAPHITI_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/';
const DEFAULT_GROUP_ID = env.GRAPHITI_GROUP_ID || process.env.GRAPHITI_GROUP_ID || 'lisa';
const ZEP_API_KEY = env.ZEP_API_KEY || process.env.ZEP_API_KEY || '';
const GRAPHITI_MODE = env.GRAPHITI_MODE || process.env.GRAPHITI_MODE || 'local';
// Helper to check if using Zep Cloud native API (not MCP)
const isZepCloudMode = () => GRAPHITI_MODE === 'zep-cloud';
module.exports = {
    PROJECT_ROOT,
    PROMPT_SKILL_PATH,
    DEV_DIR,
    MCP_ENDPOINT,
    DEFAULT_GROUP_ID,
    ZEP_API_KEY,
    GRAPHITI_MODE,
    isZepCloudMode,
};
