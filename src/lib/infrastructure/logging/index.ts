/**
 * Logging infrastructure module.
 * 
 * Provides pino-based logging with:
 * - File rotation (daily, configurable retention)
 * - Console pretty printing
 * - Correlation ID tracing via AsyncLocalStorage
 * - Environment-based configuration
 * 
 * @example
 * ```typescript
 * import { createLogger, withCorrelation } from './infrastructure/logging';
 * 
 * const logger = createLogger();
 * 
 * await withCorrelation(async () => {
 *   logger.info('Starting operation'); // includes correlationId
 *   await processData();
 *   logger.info('Completed');
 * });
 * ```
 */

// Logger implementations
export { Logger, NullLogger, DEFAULT_LOGGER_OPTIONS } from './Logger';

// Factory functions
export {
  createLogger,
  createNullLogger,
  getDefaultLogger,
  resetDefaultLogger,
  loadLoggerOptions,
} from './factory';

// Correlation context
export {
  withCorrelation,
  getCorrelationId,
  getLogContext,
  extendLogContext,
  generateCorrelationId,
  type ILogContext,
} from './context';
