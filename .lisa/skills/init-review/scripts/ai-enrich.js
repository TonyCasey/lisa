#!/usr/bin/env node
"use strict";
/**
 * AI Enrichment Worker - thin entry point.
 *
 * Background worker that enriches init-review with AI.
 * Spawned by init-review.ts after static analysis.
 *
 * Usage: node ai-enrich.js <projectRoot> <agentsDir>
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const args = process.argv.slice(2);
const projectRoot = args[0] || process.cwd();
const agentsDir = args[1] || path_1.default.join(projectRoot, '.lisa');
const STATIC_ANALYSIS_FILE = path_1.default.join(agentsDir, '.init-review-static.json');
const MARKER_FILE = path_1.default.join(agentsDir, '.init-review-done');
const LOG_FILE = path_1.default.join(agentsDir, '.init-review-enrich.log');
function log(message) {
    fs_1.default.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
}
function loadConfig() {
    const config = { endpoint: 'http://localhost:8010/mcp/', groupId: path_1.default.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-'), zepApiKey: '' };
    const envPath = path_1.default.join(agentsDir, '.env');
    try {
        if (fs_1.default.existsSync(envPath)) {
            const content = fs_1.default.readFileSync(envPath, 'utf8');
            for (const line of content.split('\n')) {
                const [key, value] = line.split('=').map(s => s.trim());
                if (key === 'GRAPHITI_ENDPOINT')
                    config.endpoint = value;
                if (key === 'GRAPHITI_GROUP_ID')
                    config.groupId = value;
                if (key === 'ZEP_API_KEY')
                    config.zepApiKey = value;
            }
        }
    }
    catch { /* use defaults */ }
    if (!config.zepApiKey)
        config.zepApiKey = process.env.ZEP_API_KEY || '';
    return config;
}
async function initializeMCP(endpoint, apiKey) {
    try {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
        if (apiKey && endpoint.includes('getzep.com'))
            headers['Authorization'] = `Api-Key ${apiKey}`;
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0', id: 'init', method: 'initialize',
                params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'init-review-enrich', version: '1.0.0' } },
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
            log(`MCP init failed: HTTP ${resp.status}`);
            return null;
        }
        return resp.headers.get('mcp-session-id');
    }
    catch (err) {
        log(`MCP init error: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
async function addEnrichedMemory(endpoint, sessionId, summary, groupId, apiKey) {
    try {
        const headers = { 'Content-Type': 'application/json', 'MCP-SESSION-ID': sessionId, Accept: 'application/json, text/event-stream' };
        if (apiKey && endpoint.includes('getzep.com'))
            headers['Authorization'] = `Api-Key ${apiKey}`;
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0', id: '1', method: 'tools/call',
                params: {
                    name: 'add_memory',
                    arguments: {
                        name: 'INIT-REVIEW (AI Enriched): ' + summary.slice(0, 60),
                        episode_body: `INIT-REVIEW: ${summary}`,
                        source: 'skill:init-review-enrich',
                        group_id: groupId,
                        tags: ['type:init-review', 'scope:codebase', 'ai:enriched'],
                    },
                },
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) {
            log(`Add memory failed: HTTP ${resp.status}`);
            return false;
        }
        return true;
    }
    catch (err) {
        log(`Add memory error: ${err instanceof Error ? err.message : err}`);
        return false;
    }
}
function generateEnrichedSummary(analysis) {
    const r = analysis.result;
    const parts = [];
    parts.push(`Project: ${r.project.name}`);
    const stack = [r.codebase.language];
    if (r.codebase.framework)
        stack.push(r.codebase.framework);
    parts.push(`Stack: ${stack.join(' + ')}`);
    if (r.patterns.architecture)
        parts.push(`Architecture: ${r.patterns.architecture}`);
    if (r.structure.mainModules.length > 0)
        parts.push(`Core modules: ${r.structure.mainModules.slice(0, 5).join(', ')}`);
    if (r.codebase.buildTools.length > 0)
        parts.push(`Build: ${r.codebase.buildTools.join(', ')}`);
    if (r.patterns.testing)
        parts.push(`Testing: ${r.patterns.testing}`);
    parts.push(`Size: ${r.metrics.fileCount} files${r.metrics.hasTests ? ', has tests' : ''}`);
    return parts.join('. ') + '.';
}
function updateMarker(enriched) {
    try {
        let content = {};
        if (fs_1.default.existsSync(MARKER_FILE))
            content = JSON.parse(fs_1.default.readFileSync(MARKER_FILE, 'utf8'));
        content.enriched = enriched;
        content.enrichedAt = new Date().toISOString();
        fs_1.default.writeFileSync(MARKER_FILE, JSON.stringify(content, null, 2));
    }
    catch (err) {
        log(`Failed to update marker: ${err instanceof Error ? err.message : err}`);
    }
}
async function main() {
    log('AI enrichment worker started');
    if (!fs_1.default.existsSync(STATIC_ANALYSIS_FILE)) {
        log('No static analysis file found');
        return;
    }
    let analysis;
    try {
        analysis = JSON.parse(fs_1.default.readFileSync(STATIC_ANALYSIS_FILE, 'utf8'));
    }
    catch (err) {
        log(`Failed to read static analysis: ${err instanceof Error ? err.message : err}`);
        return;
    }
    const enrichedSummary = generateEnrichedSummary(analysis);
    log(`Generated enriched summary: ${enrichedSummary.slice(0, 100)}...`);
    const config = loadConfig();
    log(`Using endpoint: ${config.endpoint}, group: ${config.groupId}`);
    const sessionId = await initializeMCP(config.endpoint, config.zepApiKey);
    if (!sessionId) {
        log('Could not initialize MCP');
        return;
    }
    const success = await addEnrichedMemory(config.endpoint, sessionId, enrichedSummary, config.groupId, config.zepApiKey);
    if (success) {
        log('Successfully stored enriched memory');
        updateMarker(true);
        try {
            fs_1.default.unlinkSync(STATIC_ANALYSIS_FILE);
        }
        catch { /* ignore */ }
    }
    else {
        log('Failed to store enriched memory');
    }
    log('AI enrichment worker completed');
}
main().catch(err => { log(`Worker error: ${err instanceof Error ? err.message : err}`); process.exit(1); });
//# sourceMappingURL=ai-enrich.js.map