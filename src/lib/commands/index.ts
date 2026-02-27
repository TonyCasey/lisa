/**
 * CLI Command Modules
 *
 * Exports command handlers and register functions for the Lisa CLI.
 */

export {
  doctorCommand,
  runDoctor,
  formatBasicOutput,
  formatVerboseOutput,
  formatJsonOutput,
  getExitCode,
  type IDoctorResult,
  type IDoctorOptions,
  type ICheckResult,
  type IConfigInfo,
  type ITranscriptInfo,
  type CheckStatus,
} from './doctor';

export {
  initCommand,
  cleanupPreviousInstall,
  type IInitOptions,
} from './init';

// Re-export shared constants and types for convenience
export {
  TEMPLATE_ROOT,
  BUNDLED_OPENCODE_ROOT,
  VERSION,
  DEFAULT_GROUP,
  getProjectName,
  type CliSupport,
} from './shared';

// Extracted command group registrations
export { registerHookCommands } from './hooks';
export { registerKnowledgeCommands } from './knowledge';
export { registerSkillCommands } from './skills';
export { registerIssueCommands } from './issue';
export { registerPrCommands } from './pr';

// CLI utilities
export {
  CliExitError,
  getSkillCacheEnv,
  spawnAndWait,
  runPrWatchLoop,
  type IPrWatchLoopOptions,
} from './cli-utils';

// CLI infrastructure services (for init, doctor commands)
export {
  createCliServices,
  type ICliServices,
  type ITemplateCopier,
  type IMcpPingClient,
} from './cli-services';
