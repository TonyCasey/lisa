/**
 * Shared Types for Integration Tests
 *
 * Common type definitions used across skill integration tests.
 */

/**
 * Options for CLI runner execution
 */
export interface ICliRunnerOptions {
  /** Group ID for memory/task isolation (stored as group:<id> tag in git-mem) */
  groupId?: string;
  /** Command timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Working directory for command execution */
  cwd?: string;
  /** Path to test git repository (overrides cwd for git-mem operations) */
  testRepoPath?: string;
  /** Additional environment variables to pass to child process */
  env?: Record<string, string>;
}

/**
 * Result from CLI script execution
 */
export interface ICliResult<T> {
  /** Whether the command succeeded (status === 'ok') */
  success: boolean;
  /** Parsed JSON data from stdout */
  data?: T;
  /** Error message if command failed */
  error?: string;
  /** Raw stdout from command */
  stdout: string;
  /** Raw stderr from command */
  stderr: string;
}

/**
 * Configuration for integration test suites
 */
export interface IIntegrationTestConfig {
  /** Whether tests are enabled */
  enabled: boolean;
  /** Storage backend (git-mem) */
  storageMode: 'git-mem';
  /** Path to test git repository */
  testRepoPath: string;
  /** Base group ID for test isolation */
  groupId: string;
  /** Test timeout in milliseconds */
  timeout: number;
}

/**
 * Result from a smoke test suite
 */
export interface ISmokeSuiteResult {
  /** Overall success status */
  success: boolean;
  /** Whether add operation passed */
  addPassed: boolean;
  /** Whether retrieval operation passed */
  retrievalPassed: boolean;
  /** Whether isolation check passed */
  isolationPassed: boolean;
  /** Any errors encountered */
  errors: string[];
}
