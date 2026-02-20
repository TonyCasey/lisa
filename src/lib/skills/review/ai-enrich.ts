#!/usr/bin/env node
/**
 * AI Enrichment Worker - thin entry point.
 *
 * Background worker that enriches init-review with AI.
 * Spawned by init-review.ts after static analysis.
 *
 * Usage: node ai-enrich.js <projectRoot> <agentsDir>
 *
 * Note: Group IDs are no longer used - the git repo itself provides scoping
 * via git-mem (git notes in refs/notes/mem).
 */

export {};

import fs from 'fs';
import path from 'path';

interface IStaticAnalysis {
  summary: string;
  result: {
    project: { name: string; groupId: string };
    codebase: { language: string; framework: string | null; buildTools: string[] };
    structure: { entryPoints: string[]; mainModules: string[] };
    dependencies: { noteworthy: string[] };
    patterns: { architecture: string | null; testing: string | null };
    metrics: { fileCount: number; hasTests: boolean };
  };
}

const args = process.argv.slice(2);
const projectRoot = args[0] || process.cwd();
const agentsDir = args[1] || path.join(projectRoot, '.lisa');

const STATIC_ANALYSIS_FILE = path.join(agentsDir, '.init-review-static.json');
const MARKER_FILE = path.join(agentsDir, '.init-review-done');
const LOG_FILE = path.join(agentsDir, '.init-review-enrich.log');

function log(message: string): void {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
}

function loadConfig(): { endpoint: string; zepApiKey: string } {
  const config = { endpoint: 'http://localhost:8010/mcp/', zepApiKey: '' };
  const envPath = path.join(agentsDir, '.env');

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const [key, value] = line.split('=').map(s => s.trim());
        if (key === 'GRAPHITI_ENDPOINT') config.endpoint = value;
        if (key === 'ZEP_API_KEY') config.zepApiKey = value;
      }
    }
  } catch { /* use defaults */ }

  if (!config.zepApiKey) config.zepApiKey = process.env.ZEP_API_KEY || '';
  return config;
}

async function initializeMCP(endpoint: string, apiKey?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (apiKey && endpoint.includes('getzep.com')) headers['Authorization'] = `Api-Key ${apiKey}`;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'init', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'init-review-enrich', version: '1.0.0' } },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) { log(`MCP init failed: HTTP ${resp.status}`); return null; }
    return resp.headers.get('mcp-session-id');
  } catch (err) {
    log(`MCP init error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function addEnrichedMemory(endpoint: string, sessionId: string, summary: string, apiKey?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'MCP-SESSION-ID': sessionId, Accept: 'application/json, text/event-stream' };
    if (apiKey && endpoint.includes('getzep.com')) headers['Authorization'] = `Api-Key ${apiKey}`;

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
            tags: ['type:init-review', 'scope:codebase', 'ai:enriched'],
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) { log(`Add memory failed: HTTP ${resp.status}`); return false; }
    return true;
  } catch (err) {
    log(`Add memory error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

function generateEnrichedSummary(analysis: IStaticAnalysis): string {
  const r = analysis.result;
  const parts: string[] = [];
  parts.push(`Project: ${r.project.name}`);
  const stack = [r.codebase.language];
  if (r.codebase.framework) stack.push(r.codebase.framework);
  parts.push(`Stack: ${stack.join(' + ')}`);
  if (r.patterns.architecture) parts.push(`Architecture: ${r.patterns.architecture}`);
  if (r.structure.mainModules.length > 0) parts.push(`Core modules: ${r.structure.mainModules.slice(0, 5).join(', ')}`);
  if (r.codebase.buildTools.length > 0) parts.push(`Build: ${r.codebase.buildTools.join(', ')}`);
  if (r.patterns.testing) parts.push(`Testing: ${r.patterns.testing}`);
  parts.push(`Size: ${r.metrics.fileCount} files${r.metrics.hasTests ? ', has tests' : ''}`);
  return parts.join('. ') + '.';
}

function updateMarker(enriched: boolean): void {
  try {
    let content: Record<string, unknown> = {};
    if (fs.existsSync(MARKER_FILE)) content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
    content.enriched = enriched;
    content.enrichedAt = new Date().toISOString();
    fs.writeFileSync(MARKER_FILE, JSON.stringify(content, null, 2));
  } catch (err) {
    log(`Failed to update marker: ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  log('AI enrichment worker started');

  if (!fs.existsSync(STATIC_ANALYSIS_FILE)) { log('No static analysis file found'); return; }

  let analysis: IStaticAnalysis;
  try {
    analysis = JSON.parse(fs.readFileSync(STATIC_ANALYSIS_FILE, 'utf8'));
  } catch (err) {
    log(`Failed to read static analysis: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const enrichedSummary = generateEnrichedSummary(analysis);
  log(`Generated enriched summary: ${enrichedSummary.slice(0, 100)}...`);

  const config = loadConfig();
  log(`Using endpoint: ${config.endpoint}`);

  const sessionId = await initializeMCP(config.endpoint, config.zepApiKey);
  if (!sessionId) { log('Could not initialize MCP'); return; }

  const success = await addEnrichedMemory(config.endpoint, sessionId, enrichedSummary, config.zepApiKey);

  if (success) {
    log('Successfully stored enriched memory');
    updateMarker(true);
    try { fs.unlinkSync(STATIC_ANALYSIS_FILE); } catch { /* ignore */ }
  } else {
    log('Failed to store enriched memory');
  }

  log('AI enrichment worker completed');
}

main().catch(err => { log(`Worker error: ${err instanceof Error ? err.message : err}`); process.exit(1); });
