/**
 * Shared Types for Integration Tests
 *
 * Common type definitions used across skill integration tests.
 */

/**
 * Options for CLI runner execution
 */
export interface ICliRunnerOptions {
  /** Override endpoint URL (e.g., for custom Graphiti server) */
  endpoint?: string;
  /** Group ID for memory/task isolation */
  groupId?: string;
  /** Command timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Working directory for command execution */
  cwd?: string;
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
  /** Storage mode (local MCP or zep-cloud) */
  storageMode: 'local' | 'zep-cloud';
  /** Optional endpoint override */
  endpoint?: string;
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
