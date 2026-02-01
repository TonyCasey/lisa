/**
 * Infrastructure service implementations.
 */

export { MemoryService } from './MemoryService';
export { TaskService } from './TaskService';
export { EventEmitter } from './EventEmitter';
export { SessionCaptureService } from './SessionCaptureService';
export { RecursionService } from './RecursionService';
export { LabelInferenceService, createLabelInferenceService } from './LabelInferenceService';
export { createDeduplicationService, normalizeText, extractWords, jaccardSimilarity, detectDuplicatesFromFacts } from './DeduplicationService';
export { createCurationService, computeRecencyBonus } from './CurationService';
export { createConsolidationService } from './ConsolidationService';
