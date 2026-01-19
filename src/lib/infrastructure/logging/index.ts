/**
 * Logging infrastructure module.
 *
 * Provides simple file-based logging with:
 * - Daily log files
 * - Colorized console output
 * - Correlation ID tracing via AsyncLocalStorage
 * - Environment-based configuration
 *
 * Log format: YYYY-MM-DD HH:mm:ss.SSS LEVEL message {context}
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
