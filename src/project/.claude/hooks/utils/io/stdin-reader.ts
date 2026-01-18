/**
 * Stdin Reader - Read JSON input from stdin
 *
 * Provides a consistent way to read hook input across all Claude Code hooks.
 * Supports configurable timeout and graceful fallback to empty object.
 */

/**
 * Options for reading stdin
 */
export interface IStdinReaderOptions {
  /** Timeout in milliseconds before returning empty object (default: 100) */
  timeoutMs?: number;
  /** Encoding for stdin (default: 'utf8') */
  encoding?: BufferEncoding;
}

/**
 * Default options for stdin reading
 */
const DEFAULT_OPTIONS: Required<IStdinReaderOptions> = {
  timeoutMs: 100,
  encoding: 'utf8',
};

/**
 * Read JSON from stdin with timeout support
 *
 * Used by Claude Code hooks to receive input from the CLI.
 * Returns an empty object if:
 * - No data received within timeout
 * - Invalid JSON received
 * - stdin is already closed
 *
 * @param options - Configuration options
 * @returns Parsed JSON object or empty object on failure
 *
 * @example
 * ```typescript
 * interface MyInput {
 *   trigger?: string;
 *   session_id?: string;
 * }
 *
 * const input = await readJsonStdin<MyInput>();
 * console.log(input.trigger); // 'startup' | undefined
 * ```
 */
export async function readJsonStdin<T extends object = Record<string, unknown>>(
  options: IStdinReaderOptions = {}
): Promise<T> {
  const { timeoutMs, encoding } = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const safeResolve = (value: T): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // Timeout handler - resolve with empty object if no data
    const timeoutId = setTimeout(() => {
      safeResolve({} as T);
    }, timeoutMs);

    // Check if stdin is already closed
    if (process.stdin.readableEnded) {
      clearTimeout(timeoutId);
      safeResolve({} as T);
      return;
    }

    process.stdin.setEncoding(encoding);

    // Use 'readable' event for more control (session-start style)
    process.stdin.on('readable', () => {
      let chunk: string | null;
      while ((chunk = process.stdin.read() as string | null) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('data', (chunk: Buffer | string) => {
      data += chunk.toString();
    });

    process.stdin.on('end', () => {
      clearTimeout(timeoutId);
      try {
        const parsed = JSON.parse(data) as T;
        safeResolve(parsed);
      } catch {
        // Invalid JSON - return empty object
        safeResolve({} as T);
      }
    });

    process.stdin.on('error', () => {
      clearTimeout(timeoutId);
      safeResolve({} as T);
    });
  });
}

/**
 * Read raw string from stdin with timeout support
 *
 * For cases where JSON parsing is not needed or will be done separately.
 *
 * @param options - Configuration options
 * @returns Raw string data or empty string on failure
 */
export async function readRawStdin(
  options: IStdinReaderOptions = {}
): Promise<string> {
  const { timeoutMs, encoding } = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve) => {
    let data = '';
    let resolved = false;

    const safeResolve = (value: string): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      safeResolve(data); // Return whatever we have
    }, timeoutMs);

    if (process.stdin.readableEnded) {
      clearTimeout(timeoutId);
      safeResolve('');
      return;
    }

    process.stdin.setEncoding(encoding);

    process.stdin.on('data', (chunk: Buffer | string) => {
      data += chunk.toString();
    });

    process.stdin.on('end', () => {
      clearTimeout(timeoutId);
      safeResolve(data);
    });

    process.stdin.on('error', () => {
      clearTimeout(timeoutId);
      safeResolve(data);
    });
  });
}

/**
 * Check if stdin has data available (non-blocking)
 *
 * Useful for quickly checking if there's input before setting up listeners.
 */
export function hasStdinData(): boolean {
  return !process.stdin.readableEnded && process.stdin.readable;
}
