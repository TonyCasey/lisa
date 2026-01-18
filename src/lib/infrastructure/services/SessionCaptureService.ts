import type { ISessionCaptureService, ICapturedWork } from '../../domain';
import { emptyCapturedWork } from '../../domain';

/**
 * Service for capturing session work.
 * 
 * NOTE: This is a placeholder implementation.
 * The actual session capture logic (transcript parsing, fact extraction)
 * should be extracted from session-stop-worker.ts.
 */
export class SessionCaptureService implements ISessionCaptureService {
  /**
   * Capture work from the current session.
   * 
   * TODO: Implement actual transcript analysis and fact extraction.
   * This may involve spawning a background worker process.
   */
  async captureSessionWork(_sessionId?: string): Promise<ICapturedWork> {
    // Placeholder - returns empty result
    // Real implementation would:
    // 1. Read session transcript
    // 2. Analyze for meaningful work
    // 3. Extract facts worth remembering
    // 4. Rate complexity
    return emptyCapturedWork();
  }
}
