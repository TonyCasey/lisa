import type { ISessionCaptureService, ICapturedWork } from '../../domain';
import { emptyCapturedWork } from '../../domain';

/**
 * Service for capturing session work.
 * 
 * NOTE: This is a STUB implementation. The actual session capture logic
 * lives in session-stop-worker.ts and is invoked via hooks (session-stop.ts).
 * 
 * This stub exists to satisfy the ISessionCaptureService interface for
 * library consumers who may want to integrate session capture differently.
 * 
 * For the full implementation, see:
 * - src/project/.claude/hooks/session-stop.ts (hook that spawns worker)
 * - src/project/.claude/hooks/session-stop-worker.ts (actual capture logic)
 * 
 * @see https://github.com/your-repo/issues/XXX for implementation tracking
 */
export class SessionCaptureService implements ISessionCaptureService {
  /**
   * Capture work from the current session.
   * 
   * STUB: Returns empty result. The actual implementation is in session-stop-worker.ts.
   * 
   * A full implementation would:
   * 1. Read session transcript from Claude's session files
   * 2. Parse transcript for meaningful work (file changes, decisions)
   * 3. Extract facts worth remembering using complexity rating
   * 4. Save to Graphiti via MCP
   */
  async captureSessionWork(_sessionId?: string): Promise<ICapturedWork> {
    // Return empty result - actual logic is in session-stop-worker.ts
    return emptyCapturedWork();
  }
}
