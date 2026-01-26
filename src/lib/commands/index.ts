/**
 * CLI Command Modules
 *
 * Exports command handlers for the Lisa CLI.
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

export {
  upCommand,
  downCommand,
  type IDockerOptions,
} from './docker';

// Re-export shared constants and types for convenience
export {
  TEMPLATE_ROOT,
  BUNDLED_OPENCODE_ROOT,
  VERSION,
  DEFAULT_ENDPOINT,
  ZEP_CLOUD_ENDPOINT,
  DEFAULT_GROUP,
  getProjectName,
  type DeploymentMode,
  type CliSupport,
  type IGraphitiConfig,
} from './shared';
