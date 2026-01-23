/**
 * GitHub CLI (gh) client implementation.
 * Wraps the `gh` CLI with GITHUB_TOKEN fallback support.
 */
import { spawn } from 'child_process';
import type { IGhCliClient, IGhCliClientConfig, IGhCliResult } from './interfaces';

/**
 * Default configuration values.
 */
const DEFAULTS = {
  timeoutMs: 30000,
};

/**
 * Execute a command and capture output.
 */
async function execCommand(
  command: string,
  args: string[],
  options: {
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    input?: string;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }

    child.on('error', (err) => {
      reject(new Error(`Failed to execute ${command}: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Check if gh CLI is available.
 */
async function isGhCliAvailable(): Promise<boolean> {
  try {
    const result = await execCommand('gh', ['--version'], { timeoutMs: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated.
 */
async function isGhCliAuthenticated(): Promise<boolean> {
  try {
    const result = await execCommand('gh', ['auth', 'status'], { timeoutMs: 10000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Creates a gh CLI client instance.
 * 
 * Authentication priority:
 * 1. gh CLI authentication (if available and logged in)
 * 2. GITHUB_TOKEN environment variable
 * 
 * @param config - Client configuration
 * @returns IGhCliClient instance
 */
export function createGhCliClient(config: IGhCliClientConfig = {}): IGhCliClient {
  const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
  const token = config.token ?? process.env.GITHUB_TOKEN;

  // Cache auth check results
  let cachedAuthMethod: 'gh-cli' | 'token' | null | undefined;

  return {
    async run<T>(args: string[]): Promise<IGhCliResult<T>> {
      const authMethod = await this.getAuthMethod();
      
      if (!authMethod) {
        return {
          success: false,
          error: 'Not authenticated. Run "gh auth login" or set GITHUB_TOKEN environment variable.',
          exitCode: 1,
        };
      }

      // Build environment with token if using token auth
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (authMethod === 'token' && token) {
        env.GITHUB_TOKEN = token;
      }

      // Always request JSON output
      const fullArgs = [...args];
      if (!fullArgs.includes('--json') && !fullArgs.includes('-q')) {
        // For commands that support --json, we'll handle it at the service layer
      }

      try {
        const result = await execCommand('gh', fullArgs, { timeoutMs, env });

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: result.stderr || result.stdout || `Command failed with exit code ${result.exitCode}`,
            exitCode: result.exitCode,
          };
        }

        // Try to parse as JSON
        if (result.stdout) {
          try {
            const data = JSON.parse(result.stdout) as T;
            return { success: true, data, exitCode: 0 };
          } catch {
            // Not JSON, return as-is (wrapped in object)
            return { 
              success: true, 
              data: { raw: result.stdout } as unknown as T, 
              exitCode: 0 
            };
          }
        }

        return { success: true, data: undefined, exitCode: 0 };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    },

    async runGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<IGhCliResult<T>> {
      const authMethod = await this.getAuthMethod();
      
      if (!authMethod) {
        return {
          success: false,
          error: 'Not authenticated. Run "gh auth login" or set GITHUB_TOKEN environment variable.',
          exitCode: 1,
        };
      }

      // Build environment with token if using token auth
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (authMethod === 'token' && token) {
        env.GITHUB_TOKEN = token;
      }

      // Build gh api graphql command
      const args = ['api', 'graphql'];
      
      // Add query
      args.push('-f', `query=${query}`);
      
      // Add variables
      if (variables) {
        for (const [key, value] of Object.entries(variables)) {
          if (typeof value === 'string') {
            args.push('-f', `${key}=${value}`);
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            args.push('-F', `${key}=${value}`);
          } else {
            args.push('-f', `${key}=${JSON.stringify(value)}`);
          }
        }
      }

      try {
        const result = await execCommand('gh', args, { timeoutMs, env });

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: result.stderr || result.stdout || `GraphQL query failed with exit code ${result.exitCode}`,
            exitCode: result.exitCode,
          };
        }

        if (result.stdout) {
          try {
            const data = JSON.parse(result.stdout) as T;
            return { success: true, data, exitCode: 0 };
          } catch {
            return {
              success: false,
              error: `Failed to parse GraphQL response: ${result.stdout.slice(0, 200)}`,
              exitCode: 1,
            };
          }
        }

        return { success: true, data: undefined, exitCode: 0 };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    },

    async isAuthenticated(): Promise<boolean> {
      const method = await this.getAuthMethod();
      return method !== null;
    },

    async getAuthMethod(): Promise<'gh-cli' | 'token' | null> {
      // Return cached result if available
      if (cachedAuthMethod !== undefined) {
        return cachedAuthMethod;
      }

      // Check gh CLI first
      const ghAvailable = await isGhCliAvailable();
      if (ghAvailable) {
        const ghAuthed = await isGhCliAuthenticated();
        if (ghAuthed) {
          cachedAuthMethod = 'gh-cli';
          return cachedAuthMethod;
        }
      }

      // Fall back to token
      if (token) {
        cachedAuthMethod = 'token';
        return cachedAuthMethod;
      }

      cachedAuthMethod = null;
      return cachedAuthMethod;
    },
  };
}

/**
 * Create a gh CLI client from environment configuration.
 */
export function createGhCliClientFromEnv(): IGhCliClient {
  return createGhCliClient({
    token: process.env.GITHUB_TOKEN,
    timeoutMs: process.env.GH_TIMEOUT_MS ? parseInt(process.env.GH_TIMEOUT_MS, 10) : undefined,
  });
}
