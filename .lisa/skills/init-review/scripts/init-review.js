#!/usr/bin/env node
"use strict";
/**
 * Init Review CLI - thin entry point.
 *
 * Commands:
 *   node init-review.js run [--force]   - Run static analysis + queue AI enrichment
 *   node init-review.js show            - Show current init review from memory
 *   node init-review.js status          - Check if init review is done
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
async function main() {
    const { createInitReviewService } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    const service = createInitReviewService();
    const args = process.argv.slice(2);
    const command = args[0] || 'status';
    const force = args.includes('--force');
    const projectRoot = process.cwd();
    try {
        let result;
        switch (command) {
            case 'run': {
                const marker = service.readMarker(projectRoot);
                if (marker.done && !force) {
                    result = { status: 'skipped', action: 'run', reason: 'Already done. Use --force to re-run.', timestamp: marker.timestamp };
                    break;
                }
                if (force)
                    service.deleteMarker(projectRoot);
                const codebaseInfo = service.isCodebase(projectRoot);
                if (!codebaseInfo.isCodebase) {
                    result = { status: 'skipped', action: 'run', reason: codebaseInfo.reason };
                    break;
                }
                const analysis = service.runAnalysis(projectRoot);
                const summary = service.generateSummary(analysis);
                try {
                    await service.storeToMemory(summary, projectRoot);
                }
                catch (err) {
                    console.error(`Warning: Could not store to memory: ${err instanceof Error ? err.message : err}`);
                }
                service.writeMarker(projectRoot, false);
                // Save for AI enrichment
                const lisaDir = path_1.default.join(projectRoot, '.lisa');
                const staticFile = path_1.default.join(lisaDir, '.init-review-static.json');
                try {
                    fs_1.default.writeFileSync(staticFile, JSON.stringify({ summary, result: analysis }, null, 2));
                }
                catch { /* ignore */ }
                // Spawn AI enrichment worker
                const enrichWorker = path_1.default.join(__dirname, 'ai-enrich.js');
                if (fs_1.default.existsSync(enrichWorker)) {
                    try {
                        const child = (0, child_process_1.spawn)('node', [enrichWorker, projectRoot, lisaDir], {
                            cwd: projectRoot, stdio: 'ignore', detached: true, windowsHide: true,
                        });
                        child.unref();
                    }
                    catch { /* ignore */ }
                }
                result = { status: 'ok', action: 'run', result: analysis, summary, enrichmentQueued: fs_1.default.existsSync(enrichWorker) };
                break;
            }
            case 'show': {
                const marker = service.readMarker(projectRoot);
                if (!marker.done) {
                    result = { status: 'not_found', action: 'show', message: 'No init review found. Run: node init-review.js run' };
                    break;
                }
                const review = await service.loadFromMemory(projectRoot);
                result = { status: 'ok', action: 'show', review: review || 'Not found in memory', enriched: marker.enriched, timestamp: marker.timestamp };
                break;
            }
            case 'status': {
                const marker = service.readMarker(projectRoot);
                const codebaseInfo = service.isCodebase(projectRoot);
                result = {
                    status: 'ok', action: 'status',
                    isCodebase: codebaseInfo.isCodebase, confidence: codebaseInfo.confidence,
                    done: marker.done, enriched: marker.enriched, timestamp: marker.timestamp,
                    groupId: service.getCurrentGroupId(projectRoot),
                };
                break;
            }
            default:
                result = { status: 'error', error: `Unknown command: ${command}. Use run|show|status` };
        }
        console.log(JSON.stringify(result, null, 2));
    }
    catch (err) {
        console.log(JSON.stringify({ status: 'error', error: err instanceof Error ? err.message : String(err) }, null, 2));
        process.exit(1);
    }
}
// Export for postinstall
module.exports = {
    isCodebase: (p) => Promise.resolve().then(() => __importStar(require('../../shared/services'))).then(m => m.createInitReviewService().isCodebase(p)),
    runAnalysis: (p) => Promise.resolve().then(() => __importStar(require('../../shared/services'))).then(m => m.createInitReviewService().runAnalysis(p)),
    generateSummary: (r) => Promise.resolve().then(() => __importStar(require('../../shared/services'))).then(m => m.createInitReviewService().generateSummary(r)),
    writeMarker: (p, e) => Promise.resolve().then(() => __importStar(require('../../shared/services'))).then(m => m.createInitReviewService().writeMarker(p, e)),
};
main();
//# sourceMappingURL=init-review.js.map