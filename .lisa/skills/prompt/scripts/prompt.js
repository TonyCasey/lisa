#!/usr/bin/env node
"use strict";
/**
 * Prompt Capture CLI - thin entry point.
 *
 * Stores user prompts as episodes in Graphiti MCP.
 *
 * Usage: node prompt.js --text "prompt text" [--role user] [--source user-prompt] [--force]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
async function main() {
    const { loadEnv } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/env')));
    const { getCurrentGroupId } = await Promise.resolve().then(() => __importStar(require('../../shared/group-id')));
    const { popFlag, hasFlag } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/cli')));
    const { createMcpClient, createMcpConfigFromEnv } = await Promise.resolve().then(() => __importStar(require('../../shared/clients')));
    const { createPromptService } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    const env = loadEnv();
    const args = process.argv.slice(2);
    const explicitGroup = popFlag(args, '--group', null);
    const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();
    const text = popFlag(args, '--text', null) || popFlag(args, '-t', null);
    const role = popFlag(args, '--role', 'user') || popFlag(args, '-r', 'user');
    const source = popFlag(args, '--source', 'user-prompt') || popFlag(args, '-s', 'user-prompt');
    const force = hasFlag(args, '--force');
    // Skip legacy --kind flag
    popFlag(args, '--kind', null);
    popFlag(args, '-k', null);
    if (!text) {
        console.error('prompt requires --text');
        process.exit(1);
    }
    const mcpClient = createMcpClient(createMcpConfigFromEnv(env.raw));
    const service = createPromptService({ mcpClient });
    try {
        const result = await service.addPrompt({ text, role, source, force, groupId });
        if (result.status === 'skipped') {
            console.log('Duplicate prompt; skipping (use --force to override).');
        }
        console.log(JSON.stringify(result, null, 2));
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
main();
//# sourceMappingURL=prompt.js.map