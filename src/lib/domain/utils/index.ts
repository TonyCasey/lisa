/**
 * Domain utilities.
 *
 * These are domain-agnostic utilities that can be used by both
 * application and infrastructure layers.
 */
export {
  CancellationError,
  isCancellationError,
  withCancellation,
  checkCancellation,
  createDeferred,
  type CancellableOptions,
  type CancellableResult,
  type Deferred,
} from './cancellation';

export {
  normalizeText,
  extractWords,
  jaccardSimilarity,
  detectDuplicatesFromFacts,
} from './deduplication';
