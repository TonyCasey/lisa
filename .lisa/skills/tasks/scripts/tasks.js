#!/usr/bin/env node
"use strict";
/**
 * Task management CLI - thin entry point.
 *
 * Commands:
 *   node tasks.js list [--group <id>] [--limit N] [--cache]
 *   node tasks.js add "task text" [--status todo|doing|done] [--tag foo] [--group <id>] [--cache]
 *   node tasks.js update "task text" [--status ...] [--tag foo] [--group <id>] [--cache]
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
async function main() {
    const { loadEnv, isZepCloudConfigured } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/env')));
    const { getCurrentGroupId, getGroupIds } = await Promise.resolve().then(() => __importStar(require('../../shared/group-id')));
    const { createLogger } = await Promise.resolve().then(() => __importStar(require('../../shared/logger')));
    const { popFlag, hasFlag } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/cli')));
    const { createCache, createCacheConfig, nullCache } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/cache')));
    const { createNeo4jClient, createNeo4jConfigFromEnv, createMcpClient, createMcpConfigFromEnv, createZepClient, createZepConfigFromEnv, } = await Promise.resolve().then(() => __importStar(require('../../shared/clients')));
    const { createTaskService, createTaskCliService } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    const env = loadEnv();
    const logger = createLogger('tasks');
    const args = process.argv.slice(2);
    const command = args.shift() ?? '';
    const explicitGroup = popFlag(args, '--group', null);
    const limit = Number(popFlag(args, '--limit', '20')) || 20;
    const status = popFlag(args, '--status', 'todo');
    const tag = popFlag(args, '--tag', null);
    const repo = popFlag(args, '--repo', path_1.default.basename(process.cwd()) || 'unknown');
    const assignee = popFlag(args, '--assignee', process.env.USER || 'unknown') || 'unknown';
    const notes = popFlag(args, '--notes', '');
    const useCache = hasFlag(args, '--cache');
    const payload = args.join(' ').trim();
    const cache = useCache ? createCache(createCacheConfig(__dirname, 'tasks.log')) : nullCache;
    const neo4jClient = createNeo4jClient(createNeo4jConfigFromEnv(env.raw));
    const mcpClient = createMcpClient(createMcpConfigFromEnv(env.raw));
    const zepConfig = createZepConfigFromEnv(env.raw);
    const zepClient = isZepCloudConfigured(env) && zepConfig ? createZepClient(zepConfig) : null;
    const taskService = createTaskService({ neo4jClient, mcpClient, zepClient });
    const cliService = createTaskCliService({
        env, logger, cache, taskService, getGroupIds, getCurrentGroupId,
    });
    try {
        const result = await cliService.run({
            command, payload, explicitGroup, limit, status, tag, repo, assignee, notes,
        });
        console.log(JSON.stringify(result, null, 2));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Command failed: ${command}`, { error: message });
        const fallback = cache.readFallback();
        if (fallback) {
            console.log(JSON.stringify({ status: 'fallback', error: message, fallback }, null, 2));
            return;
        }
        console.error(message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=tasks.js.map