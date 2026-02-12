/**
 * Infrastructure service implementations.
 */

// Domain-level git-mem services (simpler interface for DI/hooks)
export { GitMemMemoryService } from './GitMemMemoryService';
export { GitMemTaskService } from './GitMemTaskService';

// Skill-level git-mem services (rich interface for CLI scripts)
export {
  createSkillMemoryService,
  type ISkillMemoryServiceDependencies,
} from './SkillMemoryService';
export {
  createSkillTaskService,
  type ISkillTaskServiceDependencies,
} from './SkillTaskService';
export {
  createSkillPromptService,
  type ISkillPromptServiceDependencies,
} from './SkillPromptService';

// Skill interfaces (re-export for convenience)
export * from './skill-interfaces';

export { EventEmitter } from './EventEmitter';
export { SessionCaptureService } from './SessionCaptureService';
export { RecursionService } from './RecursionService';
export { LabelInferenceService, createLabelInferenceService } from './LabelInferenceService';
export { createCurationService, computeRecencyBonus } from './CurationService';
export { createPreferenceStore } from './PreferenceStore';
export { createLlmConfigService } from './LlmConfigService';
export { createLlmService } from './LlmService';
export { createLlmUsageTracker, estimateCost } from './LlmUsageTracker';
export { createLlmGuard } from './LlmGuard';
export { createSummarizationService } from './SummarizationService';
export { createTranscriptEnricher } from './TranscriptEnricher';
export { createLlmDeduplicationEnhancer } from './LlmDeduplicationEnhancer';
export { createNlCurationService } from './NlCurationService';
export { createNodeFileSystem } from './NodeFileSystem';
