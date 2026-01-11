#!/usr/bin/env node
/**
 * ai-enrich.ts - Background AI enrichment worker for init-review
 *
 * This script runs in the background after static analysis completes.
 * It submits the codebase summary to Graphiti MCP for AI-powered entity extraction,
 * generating richer context about the project architecture and patterns.
 *
 * Usage (spawned by init-review.ts or postinstall.js):
 *   node ai-enrich.js <projectRoot> <agentsDir>
 *
 * The worker:
 * 1. Reads static analysis from .agents/.init-review-static.json
 * 2. Submits to Graphiti MCP for enrichment
 * 3. Updates memory with enriched summary
 * 4. Updates marker file with enriched: true
 */

export {}; // ensure module scope

const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

const args = process.argv.slice(2);
const projectRoot = args[0] || process.cwd();
const agentsDir = args[1] || path.join(projectRoot, '.agents');

const STATIC_ANALYSIS_FILE = path.join(agentsDir, '.init-review-static.json');
const MARKER_FILE = path.join(agentsDir, '.init-review-done');
const LOG_FILE = path.join(agentsDir, '.init-review-enrich.log');

// ============================================================================
// Logging
// ============================================================================

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// ============================================================================
// MCP Client (simplified for enrichment)
// ============================================================================

interface IMCPConfig {
  endpoint: string;
  groupId: string;
  zepApiKey: string;
}

function loadConfig(): IMCPConfig {
  const envPath = path.join(agentsDir, 'skills', '.env');
  const config: IMCPConfig = {
    endpoint: 'http://localhost:8010/mcp/',
    groupId: path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    zepApiKey: '',
  };

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const [key, value] = line.split('=').map((s: string) => s.trim());
        if (key === 'GRAPHITI_ENDPOINT') config.endpoint = value;
        if (key === 'GRAPHITI_GROUP_ID') config.groupId = value;
        if (key === 'ZEP_API_KEY') config.zepApiKey = value;
      }
    }
  } catch (_) {
    // Use defaults
  }

  // Also check environment variable
  if (!config.zepApiKey) {
    config.zepApiKey = process.env.ZEP_API_KEY || '';
  }

  return config;
}

async function initializeMCP(endpoint: string, apiKey?: string): Promise<string | null> {
  try {
    const body = {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'init-review-enrich', version: '1.0.0' },
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Add Authorization header for Zep Cloud endpoints
    if (apiKey && endpoint.includes('getzep.com')) {
      headers['Authorization'] = `Api-Key ${apiKey}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      log(`MCP init failed: HTTP ${resp.status}`);
      return null;
    }

    const sessionId = resp.headers.get('mcp-session-id');
    return sessionId;
  } catch (err) {
    log(`MCP init error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function addEnrichedMemory(
  endpoint: string,
  sessionId: string,
  summary: string,
  groupId: string,
  apiKey?: string
): Promise<boolean> {
  try {
    const payload = {
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
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
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'MCP-SESSION-ID': sessionId,
      Accept: 'application/json, text/event-stream',
    };

    // Add Authorization header for Zep Cloud endpoints
    if (apiKey && endpoint.includes('getzep.com')) {
      headers['Authorization'] = `Api-Key ${apiKey}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      log(`Add memory failed: HTTP ${resp.status}`);
      return false;
    }

    return true;
  } catch (err) {
    log(`Add memory error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ============================================================================
// Enrichment Logic
// ============================================================================

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

function generateEnrichedSummary(analysis: IStaticAnalysis): string {
  const r = analysis.result;
  const parts: string[] = [];

  // Project identity
  parts.push(`Project: ${r.project.name}`);

  // Tech stack
  const stack = [r.codebase.language];
  if (r.codebase.framework) stack.push(r.codebase.framework);
  parts.push(`Stack: ${stack.join(' + ')}`);

  // Architecture
  if (r.patterns.architecture) {
    parts.push(`Architecture: ${r.patterns.architecture}`);
  }

  // Key modules
  if (r.structure.mainModules.length > 0) {
    parts.push(`Core modules: ${r.structure.mainModules.slice(0, 5).join(', ')}`);
  }

  // Entry points
  if (r.structure.entryPoints.length > 0) {
    parts.push(`Entry: ${r.structure.entryPoints.slice(0, 3).join(', ')}`);
  }

  // Key dependencies
  if (r.dependencies.noteworthy.length > 0) {
    parts.push(`Key deps: ${r.dependencies.noteworthy.slice(0, 5).join(', ')}`);
  }

  // Build & test
  if (r.codebase.buildTools.length > 0) {
    parts.push(`Build: ${r.codebase.buildTools.join(', ')}`);
  }
  if (r.patterns.testing) {
    parts.push(`Testing: ${r.patterns.testing}`);
  }

  // Metrics
  parts.push(`Size: ${r.metrics.fileCount} files${r.metrics.hasTests ? ', has tests' : ''}`);

  return parts.join('. ') + '.';
}

// ============================================================================
// Marker File
// ============================================================================

function updateMarker(enriched: boolean): void {
  try {
    let content: Record<string, unknown> = {};
    if (fs.existsSync(MARKER_FILE)) {
      content = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
    }
    content.enriched = enriched;
    content.enrichedAt = new Date().toISOString();
    fs.writeFileSync(MARKER_FILE, JSON.stringify(content, null, 2));
  } catch (err) {
    log(`Failed to update marker: ${err instanceof Error ? err.message : err}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  log('AI enrichment worker started');

  // Check for static analysis file
  if (!fs.existsSync(STATIC_ANALYSIS_FILE)) {
    log('No static analysis file found, exiting');
    return;
  }

  // Read static analysis
  let analysis: IStaticAnalysis;
  try {
    analysis = JSON.parse(fs.readFileSync(STATIC_ANALYSIS_FILE, 'utf8'));
  } catch (err) {
    log(`Failed to read static analysis: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Generate enriched summary
  const enrichedSummary = generateEnrichedSummary(analysis);
  log(`Generated enriched summary: ${enrichedSummary.slice(0, 100)}...`);

  // Load config
  const config = loadConfig();
  log(`Using endpoint: ${config.endpoint}, group: ${config.groupId}`);

  // Initialize MCP (pass API key for Zep Cloud auth)
  const sessionId = await initializeMCP(config.endpoint, config.zepApiKey);
  if (!sessionId) {
    log('Could not initialize MCP, skipping enrichment');
    // Still mark as done but not enriched
    return;
  }

  // Add enriched memory (pass API key for Zep Cloud auth)
  const success = await addEnrichedMemory(
    config.endpoint,
    sessionId,
    enrichedSummary,
    config.groupId,
    config.zepApiKey
  );

  if (success) {
    log('Successfully stored enriched memory');
    updateMarker(true);

    // Clean up static analysis file
    try {
      fs.unlinkSync(STATIC_ANALYSIS_FILE);
    } catch (_) {
      // Ignore cleanup errors
    }
  } else {
    log('Failed to store enriched memory');
  }

  log('AI enrichment worker completed');
}

main().catch((err) => {
  log(`Worker error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
