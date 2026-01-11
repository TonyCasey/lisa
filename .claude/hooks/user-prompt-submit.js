#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Claude Code - User Prompt Submit Hook
 *
 * This hook runs before a user's prompt is submitted to Claude.
 * It can be used to validate, enhance, or log prompts.
 *
 * Configuration: .claude/settings.json -> hooks.UserPromptSubmit
 *
 * Note: This hook is optional and only runs if configured.
 * If the hook exits with non-zero status, the prompt submission is cancelled.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROJECT_ROOT, PROMPT_SKILL_PATH, DEV_DIR } = require('../config');
/**
 * Validate prompt for potentially problematic patterns
 */
function validatePrompt(prompt) {
    const warnings = [];
    // Check for overly broad requests
    if (prompt.toLowerCase().includes('delete all') ||
        prompt.toLowerCase().includes('remove everything')) {
        warnings.push('  Destructive operation detected - please be specific');
    }
    // Check for requests without context
    if (prompt.length < 10) {
        warnings.push('  Very short prompt - consider providing more context');
    }
    return warnings;
}
/**
 * Enhance prompt with project context if needed
 */
function enhancePrompt(prompt) {
    const suggestions = [];
    if (prompt.toLowerCase().includes('architecture') ||
        prompt.toLowerCase().includes('structure')) {
        const archPath = path.join(DEV_DIR, 'architecture.md');
        if (fs.existsSync(archPath)) {
            suggestions.push(' Consider referencing @.dev/architecture.md for context');
        }
    }
    if (prompt.toLowerCase().includes('todo') ||
        prompt.toLowerCase().includes('task')) {
        const todoPath = path.join(DEV_DIR, 'todo.md');
        if (fs.existsSync(todoPath)) {
            suggestions.push(' Your todo list is available at @.dev/todo.md');
        }
    }
    return suggestions;
}
/**
 * Log prompt for analytics (optional)
 */
function logPrompt(prompt) {
    const logPath = path.join(DEV_DIR, '.prompt-log.jsonl');
    const logEntry = {
        timestamp: new Date().toISOString(),
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 100)
    };
    try {
        fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    }
    catch (_error) {
        // Silently fail if logging doesn't work
    }
}
/**
 * Check if Graphiti MCP server is available
 * Returns true if server responds, false otherwise
 */
async function isGraphitiAvailable() {
    // Read endpoint from .env file (same logic as prompt skill)
    const envPath = path.join(PROJECT_ROOT, '.agents', 'skills', '.env');
    let endpoint = 'http://localhost:8010/mcp/';
    try {
        if (fs.existsSync(envPath)) {
            const raw = fs.readFileSync(envPath, 'utf8');
            const lines = raw.split(/\r?\n/);
            for (const line of lines) {
                if (line.startsWith('GRAPHITI_ENDPOINT=')) {
                    endpoint = line.slice('GRAPHITI_ENDPOINT='.length).trim();
                    break;
                }
            }
        }
    }
    catch {
        // Use default endpoint
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'health',
                method: 'ping',
                params: {}
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok || response.status === 400; // 400 means server is up but method not found
    }
    catch {
        return false;
    }
}
/**
 * Store prompt to Graphiti MCP for cross-session memory
 * Graphiti's LLM automatically classifies the content as:
 * - KeyDecision, DirectionChange, ArchitecturalChoice, Preference, etc.
 * Classification happens server-side based on entity_types in config.yaml
 */
async function storeToGraphiti(prompt) {
    if (!fs.existsSync(PROMPT_SKILL_PATH)) {
        return null; // Silently skip if skill not found
    }
    // Check if Graphiti is available before attempting storage
    const available = await isGraphitiAvailable();
    if (!available) {
        return { status: 'unavailable' };
    }
    return new Promise((resolve) => {
        const child = spawn('node', [
            PROMPT_SKILL_PATH,
            '--text', prompt,
            '--role', 'user',
            '--source', 'user-prompt' // Graphiti LLM classifies content automatically
        ], {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data; });
        child.stderr.on('data', (data) => { stderr += data; });
        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                }
                catch {
                    resolve({ status: 'ok', raw: stdout.trim() });
                }
            }
            else {
                // Check if it's a connection error
                const errorMsg = stderr.trim() || `exit code ${code}`;
                if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED')) {
                    resolve({ status: 'unavailable' });
                }
                else {
                    resolve({ status: 'error', error: errorMsg });
                }
            }
        });
        child.on('error', (err) => {
            if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
                resolve({ status: 'unavailable' });
            }
            else {
                resolve({ status: 'error', error: err.message });
            }
        });
        // Timeout after 5 seconds
        setTimeout(() => {
            child.kill();
            resolve({ status: 'timeout' });
        }, 5000);
    });
}
/**
 * Main execution - reads JSON from stdin (Claude Code hook protocol)
 */
function main() {
    let inputData = '';
    // Read JSON from stdin
    process.stdin.on('data', (chunk) => {
        inputData += chunk;
    });
    process.stdin.on('end', async () => {
        try {
            const hookInput = JSON.parse(inputData);
            const prompt = hookInput.prompt || '';
            if (!prompt) {
                console.log('  No prompt in hook input');
                process.exit(0);
            }
            // Log what we captured for debugging
            console.log(`Captured prompt (${prompt.length} chars): "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);
            // Validate prompt
            const warnings = validatePrompt(prompt);
            if (warnings.length > 0) {
                warnings.forEach(warning => console.log(warning));
            }
            // Enhance prompt with suggestions
            const suggestions = enhancePrompt(prompt);
            if (suggestions.length > 0) {
                suggestions.forEach(suggestion => console.log(suggestion));
            }
            // Log prompt for analytics
            logPrompt(prompt);
            // Store to Graphiti MCP for cross-session memory
            const graphitiResult = await storeToGraphiti(prompt);
            if (graphitiResult) {
                if (graphitiResult.status === 'ok') {
                    // Successfully stored - no need to show message
                }
                else if (graphitiResult.status === 'skipped') {
                    // Duplicate - silently skip
                }
                else if (graphitiResult.status === 'unavailable') {
                    console.log('  lisa works but needs further setup to persist her memory');
                }
                else if (graphitiResult.status === 'error') {
                    // Only show actual errors, not connection issues
                    console.log('  lisa works but needs further setup to persist her memory');
                }
                else if (graphitiResult.status === 'timeout') {
                    console.log('  lisa works but needs further setup to persist her memory');
                }
            }
            // Exit with 0 to allow prompt to proceed
            process.exit(0);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(` Failed to parse hook input: ${message}`);
            // Exit with 0 to not block the prompt on errors
            process.exit(0);
        }
    });
}
// Run if called directly
if (require.main === module) {
    try {
        main();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(` Prompt validation failed: ${message}`);
        // Exit with 0 to not block the prompt
        process.exit(0);
    }
}
module.exports = { validatePrompt, enhancePrompt, logPrompt };
