import type { ICapturedWork } from './types';

/**
 * Service responsible for capturing session work.
 * Analyzes session transcript and extracts facts worth remembering.
 */
export interface ISessionCaptureService {
  /**
   * Capture work from the current session.
   * May spawn a background worker for async processing.
   * 
   * @param sessionId - Optional session ID
   * @returns Captured work including facts and complexity assessment
   */
  captureSessionWork(sessionId?: string): Promise<ICapturedWork>;
}
