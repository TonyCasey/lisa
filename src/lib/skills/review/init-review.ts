#!/usr/bin/env node
/**
 * Init Review CLI - thin entry point.
 *
 * Commands:
 *   node init-review.js run [--force]   - Run static analysis + queue AI enrichment
 *   node init-review.js show            - Show current init review from memory
 *   node init-review.js status          - Check if init review is done
 */

export {};

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

async function main(): Promise<void> {
  const { createInitReviewService } = await import('../shared/services');

  const service = createInitReviewService();
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const force = args.includes('--force');
  const projectRoot = process.cwd();

  try {
    let result: Record<string, unknown>;

    switch (command) {
      case 'run': {
        const marker = service.readMarker(projectRoot);
        if (marker.done && !force) {
          result = { status: 'skipped', action: 'run', reason: 'Already done. Use --force to re-run.', timestamp: marker.timestamp };
          break;
        }

        if (force) service.deleteMarker(projectRoot);

        const codebaseInfo = service.isCodebase(projectRoot);
        if (!codebaseInfo.isCodebase) {
          result = { status: 'skipped', action: 'run', reason: codebaseInfo.reason };
          break;
        }

        const analysis = service.runAnalysis(projectRoot);
        const summary = service.generateSummary(analysis);

        try {
          await service.storeToMemory(summary, projectRoot);
        } catch (err) {
          console.error(`Warning: Could not store to memory: ${err instanceof Error ? err.message : err}`);
        }

        service.writeMarker(projectRoot, false);

        // Save for AI enrichment
        const lisaDir = path.join(projectRoot, '.lisa');
        const staticFile = path.join(lisaDir, '.init-review-static.json');
        try {
          fs.writeFileSync(staticFile, JSON.stringify({ summary, result: analysis }, null, 2));
        } catch { /* ignore */ }

        // Spawn AI enrichment worker
        const enrichWorker = path.join(__dirname, 'ai-enrich.js');
        if (fs.existsSync(enrichWorker)) {
          try {
            const child = spawn('node', [enrichWorker, projectRoot, lisaDir], {
              cwd: projectRoot, stdio: 'ignore', detached: true, windowsHide: true,
            });
            child.unref();
          } catch { /* ignore */ }
        }

        result = { status: 'ok', action: 'run', result: analysis, summary, enrichmentQueued: fs.existsSync(enrichWorker) };
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
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  }
}

// Export for postinstall
module.exports = {
  isCodebase: (p: string) => import('../shared/services').then(m => m.createInitReviewService().isCodebase(p)),
  runAnalysis: (p: string) => import('../shared/services').then(m => m.createInitReviewService().runAnalysis(p)),
  generateSummary: (r: unknown) => import('../shared/services').then(m => m.createInitReviewService().generateSummary(r as Parameters<ReturnType<typeof import('../shared/services').createInitReviewService>['generateSummary']>[0])),
  writeMarker: (p: string, e?: boolean) => import('../shared/services').then(m => m.createInitReviewService().writeMarker(p, e)),
};

main();
