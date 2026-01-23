/**
 * Interface for GitHub CLI (gh) wrapper.
 * Provides abstraction over the gh CLI with GITHUB_TOKEN fallback support.
 */

/**
 * Result from a gh CLI command execution.
 */
export interface IGhCliResult<T> {
  /** Whether the command succeeded */
  success: boolean;
  /** Parsed data on success */
  data?: T;
  /** Error message on failure */
  error?: string;
  /** Exit code from the command */
  exitCode?: number;
}

/**
 * Configuration for creating a gh CLI client.
 */
export interface IGhCliClientConfig {
  /** GitHub token for API fallback (optional, uses gh auth by default) */
  token?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * GitHub CLI client interface.
 * Wraps the `gh` CLI commands with structured input/output.
 */
export interface IGhCliClient {
  /**
   * Execute a gh CLI command with JSON output.
   * @param args - Command arguments (e.g., ['issue', 'list', '--repo', 'owner/repo'])
   * @returns Parsed JSON result
   */
  run<T>(args: string[]): Promise<IGhCliResult<T>>;

  /**
   * Execute a GraphQL query via gh api graphql.
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Parsed GraphQL response
   */
  runGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<IGhCliResult<T>>;

  /**
   * Check if the client is authenticated (either via gh auth or GITHUB_TOKEN).
   * @returns true if authenticated
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Get the authentication method being used.
   * @returns 'gh-cli' | 'token' | null
   */
  getAuthMethod(): Promise<'gh-cli' | 'token' | null>;
}
