"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for Transcript Parser
 *
 * Tests the JSONL transcript parsing for Claude Code sessions.
 */
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
// Import the module (CommonJS style)
const { parseTranscript, formatDuration } = require('../transcript-parser');
(0, node_test_1.describe)('parseTranscript', () => {
    let tempDir;
    let tempFile;
    (0, node_test_1.beforeEach)(() => {
        tempDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'transcript-test-'));
        tempFile = node_path_1.default.join(tempDir, 'transcript.jsonl');
    });
    (0, node_test_1.afterEach)(() => {
        try {
            node_fs_1.default.rmSync(tempDir, { recursive: true, force: true });
        }
        catch (_e) {
            // Ignore cleanup errors
        }
    });
    (0, node_test_1.it)('should return empty summary for non-existent file', () => {
        const result = parseTranscript('/non/existent/path.jsonl');
        node_assert_1.default.strictEqual(result.filesModified.size, 0);
        node_assert_1.default.strictEqual(result.filesCreated.size, 0);
        node_assert_1.default.strictEqual(result.commandsRun.length, 0);
        node_assert_1.default.strictEqual(result.toolsUsed.size, 0);
    });
    (0, node_test_1.it)('should parse empty file', () => {
        node_fs_1.default.writeFileSync(tempFile, '');
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.filesModified.size, 0);
    });
    (0, node_test_1.it)('should extract file writes', () => {
        const entries = [
            {
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            name: 'Write',
                            input: { file_path: '/project/src/new-file.ts', content: 'export {}' },
                        },
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.filesCreated.size, 1);
        node_assert_1.default.ok(result.filesCreated.has('/project/src/new-file.ts'));
    });
    (0, node_test_1.it)('should extract file edits', () => {
        const entries = [
            {
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            name: 'Edit',
                            input: { file_path: '/project/src/existing.ts', old_string: 'a', new_string: 'b' },
                        },
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.filesModified.size, 1);
        node_assert_1.default.ok(result.filesModified.has('/project/src/existing.ts'));
    });
    (0, node_test_1.it)('should extract bash commands', () => {
        const entries = [
            {
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            name: 'Bash',
                            input: { command: 'npm install lodash' },
                        },
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.commandsRun.length, 1);
        node_assert_1.default.ok(result.commandsRun[0].includes('npm install'));
    });
    (0, node_test_1.it)('should skip read-only commands', () => {
        const entries = [
            {
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
                        { type: 'tool_use', name: 'Bash', input: { command: 'cat file.txt' } },
                        { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
                        { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } }, // This should be kept
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.commandsRun.length, 1);
        node_assert_1.default.ok(result.commandsRun[0].includes('npm run build'));
    });
    (0, node_test_1.it)('should track tool usage counts', () => {
        const entries = [
            {
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
                        { type: 'tool_use', name: 'Read', input: { file_path: 'b.ts' } },
                        { type: 'tool_use', name: 'Edit', input: { file_path: 'c.ts' } },
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.toolsUsed.get('Read'), 2);
        node_assert_1.default.strictEqual(result.toolsUsed.get('Edit'), 1);
    });
    (0, node_test_1.it)('should skip sidechain entries', () => {
        const entries = [
            {
                isSidechain: true,
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'tool_use', name: 'Write', input: { file_path: 'sidechain.ts' } },
                    ],
                },
            },
            {
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'tool_use', name: 'Write', input: { file_path: 'main.ts' } },
                    ],
                },
            },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.filesCreated.size, 1);
        node_assert_1.default.ok(result.filesCreated.has('main.ts'));
        node_assert_1.default.ok(!result.filesCreated.has('sidechain.ts'));
    });
    (0, node_test_1.it)('should calculate duration from timestamps', () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        const endTime = new Date('2024-01-01T10:05:00Z');
        const entries = [
            { timestamp: startTime.toISOString(), message: { role: 'user', content: 'start' } },
            { timestamp: endTime.toISOString(), message: { role: 'assistant', content: 'done' } },
        ];
        node_fs_1.default.writeFileSync(tempFile, entries.map((e) => JSON.stringify(e)).join('\n'));
        const result = parseTranscript(tempFile);
        node_assert_1.default.strictEqual(result.durationMs, 5 * 60 * 1000); // 5 minutes
    });
    (0, node_test_1.it)('should handle malformed JSON lines gracefully', () => {
        const content = [
            '{"message": {"role": "user", "content": "hello"}}',
            'not valid json',
            '{"message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Write", "input": {"file_path": "test.ts"}}]}}',
        ].join('\n');
        node_fs_1.default.writeFileSync(tempFile, content);
        const result = parseTranscript(tempFile);
        // Should still parse the valid entries
        node_assert_1.default.strictEqual(result.filesCreated.size, 1);
    });
});
(0, node_test_1.describe)('formatDuration', () => {
    (0, node_test_1.it)('should format milliseconds', () => {
        node_assert_1.default.strictEqual(formatDuration(500), '500ms');
    });
    (0, node_test_1.it)('should format seconds', () => {
        node_assert_1.default.strictEqual(formatDuration(5000), '5s');
        node_assert_1.default.strictEqual(formatDuration(45000), '45s');
    });
    (0, node_test_1.it)('should format minutes and seconds', () => {
        node_assert_1.default.strictEqual(formatDuration(65000), '1m 5s');
        node_assert_1.default.strictEqual(formatDuration(125000), '2m 5s');
    });
    (0, node_test_1.it)('should format hours and minutes', () => {
        node_assert_1.default.strictEqual(formatDuration(3665000), '1h 1m');
        node_assert_1.default.strictEqual(formatDuration(7200000), '2h 0m');
    });
});
