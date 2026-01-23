/**
 * CLI Infrastructure.
 *
 * Utilities for CLI hook commands.
 */

export {
  readJsonFromStdin,
  writeJsonToStdout,
  writeToStream,
  writeStatus,
  parseTrigger,
} from './io';

export type {
  ISessionStartInput,
  ISessionStopInput,
  IPromptSubmitInput,
  IHookOutput,
} from './io';
