"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
/**
 * Parse a JSONL transcript file and extract work summary
 */
function parseTranscript(transcriptPath) {
    const summary = {
        filesModified: new Set(),
        filesCreated: new Set(),
        commandsRun: [],
        toolsUsed: new Map(),
        assistantSummary: '',
        timestamp: new Date().toISOString(),
        durationMs: 0,
        totalCostUSD: 0,
    };
    if (!fs.existsSync(transcriptPath)) {
        return summary;
    }
    try {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.split('\n').filter((line) => line.trim());
        let firstTimestamp = null;
        let lastTimestamp = null;
        let lastAssistantMessage = '';
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                // Skip side chains (subagent work - track separately if needed)
                if (entry.isSidechain) {
                    continue;
                }
                // Track timestamps for duration calculation
                if (entry.timestamp) {
                    const ts = new Date(entry.timestamp).getTime();
                    if (firstTimestamp === null)
                        firstTimestamp = ts;
                    lastTimestamp = ts;
                }
                // Track costs
                if (entry.costUSD) {
                    summary.totalCostUSD += entry.costUSD;
                }
                // Process messages
                if (entry.message) {
                    processMessage(entry.message, summary);
                    // Track last assistant message for summary
                    if (entry.message.role === 'assistant') {
                        const text = extractTextFromMessage(entry.message);
                        if (text) {
                            lastAssistantMessage = text;
                        }
                    }
                }
            }
            catch (_parseErr) {
                // Skip malformed lines, continue parsing
                continue;
            }
        }
        // Calculate duration
        if (firstTimestamp !== null && lastTimestamp !== null) {
            summary.durationMs = lastTimestamp - firstTimestamp;
        }
        // Set the assistant summary (truncate if too long)
        summary.assistantSummary = truncateText(lastAssistantMessage, 500);
    }
    catch (_err) {
        // Return empty summary on read errors
    }
    return summary;
}
/**
 * Process a message entry and extract tool uses
 */
function processMessage(message, summary) {
    if (!message.content)
        return;
    const contents = Array.isArray(message.content)
        ? message.content
        : [{ type: 'text', text: message.content }];
    for (const content of contents) {
        if (content.type === 'tool_use' && content.name) {
            // Track tool usage count
            const count = summary.toolsUsed.get(content.name) || 0;
            summary.toolsUsed.set(content.name, count + 1);
            // Extract file operations
            if (content.input) {
                processToolInput(content.name, content.input, summary);
            }
        }
        if (content.type === 'tool_result' && content.name) {
            // Also track from tool results if present
            const count = summary.toolsUsed.get(content.name) || 0;
            if (count === 0) {
                summary.toolsUsed.set(content.name, 1);
            }
        }
    }
}
/**
 * Process tool input to extract file/command information
 */
function processToolInput(toolName, input, summary) {
    const filePath = input.file_path;
    switch (toolName) {
        case 'Write':
            if (filePath) {
                summary.filesCreated.add(normalizePath(filePath));
            }
            break;
        case 'Edit':
        case 'MultiEdit':
            if (filePath) {
                summary.filesModified.add(normalizePath(filePath));
            }
            break;
        case 'Bash':
            if (input.command) {
                // Track non-trivial commands (skip simple reads)
                const cmd = input.command.trim();
                if (!isReadOnlyCommand(cmd)) {
                    summary.commandsRun.push(truncateText(cmd, 200));
                }
            }
            break;
        case 'NotebookEdit':
            if (filePath) {
                summary.filesModified.add(normalizePath(filePath));
            }
            break;
    }
}
/**
 * Check if a command is read-only (doesn't modify state)
 */
function isReadOnlyCommand(cmd) {
    const readOnlyPatterns = [
        /^ls\s/,
        /^cat\s/,
        /^head\s/,
        /^tail\s/,
        /^grep\s/,
        /^find\s/,
        /^which\s/,
        /^echo\s/,
        /^pwd$/,
        /^git\s+status/,
        /^git\s+log/,
        /^git\s+diff/,
        /^git\s+show/,
        /^git\s+branch/,
        /^npm\s+list/,
        /^node\s+-[evp]/,
    ];
    return readOnlyPatterns.some((pattern) => pattern.test(cmd));
}
/**
 * Extract text content from a message
 */
function extractTextFromMessage(message) {
    if (typeof message.content === 'string') {
        return message.content;
    }
    if (Array.isArray(message.content)) {
        const textParts = message.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text);
        return textParts.join('\n');
    }
    return '';
}
/**
 * Normalize a file path (remove leading cwd, make relative)
 */
function normalizePath(filePath) {
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
        return filePath.slice(cwd.length + 1);
    }
    // Remove leading slash for absolute paths outside cwd
    if (filePath.startsWith('/')) {
        return filePath;
    }
    return filePath;
}
/**
 * Truncate text to a maximum length
 */
function truncateText(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return text.slice(0, maxLength - 3) + '...';
}
/**
 * Find the most recent transcript file in a directory
 */
function findMostRecentTranscript(dir) {
    if (!fs.existsSync(dir)) {
        return null;
    }
    try {
        const files = fs.readdirSync(dir)
            .filter((f) => f.endsWith('.jsonl'))
            .map((f) => {
            const fullPath = path.join(dir, f);
            return {
                path: fullPath,
                mtime: fs.statSync(fullPath).mtime.getTime(),
            };
        })
            .sort((a, b) => b.mtime - a.mtime);
        return files.length > 0 ? files[0].path : null;
    }
    catch (_err) {
        return null;
    }
}
/**
 * Get files modified during the session
 */
function getFilesModified(summary) {
    return summary.filesModified;
}
/**
 * Get tool usage distribution
 */
function getToolDistribution(summary) {
    return summary.toolsUsed;
}
/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60)
        return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}
module.exports = {
    parseTranscript,
    findMostRecentTranscript,
    getFilesModified,
    getToolDistribution,
    formatDuration,
};
