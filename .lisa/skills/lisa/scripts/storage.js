#!/usr/bin/env node
"use strict";
/**
 * Storage Mode CLI - thin entry point.
 *
 * Commands:
 *   node storage.js status [--cache]         Show current storage mode
 *   node storage.js switch <mode> [--cache]  Switch to local or zep-cloud
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
    const { createStorageService } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    const { createLogger } = await Promise.resolve().then(() => __importStar(require('../../shared/logger')));
    const { createCache, createCacheConfig, nullCache } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/cache')));
    const { hasFlag } = await Promise.resolve().then(() => __importStar(require('../../shared/utils/cli')));
    const log = createLogger('storage');
    const args = process.argv.slice(2);
    const command = args.shift() ?? '';
    const useCache = hasFlag(args, '--cache');
    const targetMode = args.shift() ?? '';
    const cache = useCache ? createCache(createCacheConfig(__dirname, 'storage.log')) : nullCache;
    const envPath = path_1.default.join(__dirname, '..', '..', '.env');
    const service = createStorageService({ envPath });
    try {
        if (!['status', 'switch'].includes(command)) {
            throw new Error('command must be status|switch');
        }
        log.info(`Executing command: ${command}`, { targetMode: targetMode || 'n/a' });
        let out;
        if (command === 'status') {
            out = await service.getStatus();
            log.debug('Status check completed', { mode: out.mode, isConnected: out.isConnected });
        }
        else {
            if (!targetMode)
                throw new Error('switch requires a mode (local or zep-cloud)');
            out = await service.switchMode(targetMode);
            log.info('Storage mode switched', { previousMode: out.previousMode, newMode: out.newMode });
        }
        if (out.status === 'ok')
            cache.write(out);
        console.log(JSON.stringify(out, null, 2));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Command failed: ${command}`, { error: message });
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
//# sourceMappingURL=storage.js.map