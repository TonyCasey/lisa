/**
 * CLI argument parsing utilities.
 * Provides functions for parsing command-line arguments in skill scripts.
 */

/**
 * Parsed CLI arguments structure.
 */
export interface IParsedArgs {
  /** The command (first positional argument) */
  command: string;
  /** Remaining positional arguments joined as payload */
  payload: string;
  /** Named flags (--flag value or --flag) */
  flags: Map<string, string | true>;
}

/**
 * Pop a flag from the args array and return its value.
 * Mutates the args array by removing the flag and its value.
 *
 * @param args - The arguments array to modify
 * @param name - The flag name (e.g., '--group')
 * @param fallback - Default value if flag not found
 * @returns The flag value or fallback
 */
export function popFlag(args: string[], name: string, fallback: string): string;
export function popFlag(args: string[], name: string, fallback: null): string | null;
export function popFlag(args: string[], name: string, fallback: string | null): string | null {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val ?? fallback;
}

/**
 * Check if a boolean flag is present and remove it from args.
 * Mutates the args array by removing the flag.
 *
 * @param args - The arguments array to modify
 * @param name - The flag name (e.g., '--cache')
 * @returns True if flag was present
 */
export function hasFlag(args: string[], name: string): boolean {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/**
 * Parse all arguments into a structured format.
 * Does not mutate the input array.
 *
 * @param argv - Raw arguments (typically process.argv.slice(2))
 * @returns Parsed arguments structure
 */
export function parseArgs(argv: string[]): IParsedArgs {
  const args = [...argv]; // Clone to avoid mutation
  const flags = new Map<string, string | true>();

  // Extract all flags first
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const flagName = arg;
      args.splice(i, 1);

      // Check if next arg is a value (not another flag)
      if (i < args.length && !args[i].startsWith('--')) {
        flags.set(flagName, args[i]);
        args.splice(i, 1);
      } else {
        flags.set(flagName, true);
      }
    } else {
      i++;
    }
  }

  // First remaining arg is command, rest is payload
  const command = args.shift() ?? '';
  const payload = args.join(' ').trim();

  return { command, payload, flags };
}

/**
 * Get a string flag value from parsed args.
 *
 * @param flags - The flags map from parseArgs
 * @param name - The flag name (e.g., '--group')
 * @param fallback - Default value if not found
 */
export function getFlag(flags: Map<string, string | true>, name: string, fallback: string): string;
export function getFlag(flags: Map<string, string | true>, name: string, fallback: null): string | null;
export function getFlag(
  flags: Map<string, string | true>,
  name: string,
  fallback: string | null
): string | null {
  const val = flags.get(name);
  if (val === undefined) return fallback;
  if (val === true) return fallback; // Boolean flag, no value
  return val;
}

/**
 * Check if a boolean flag is set in parsed args.
 *
 * @param flags - The flags map from parseArgs
 * @param name - The flag name (e.g., '--cache')
 */
export function hasArgFlag(flags: Map<string, string | true>, name: string): boolean {
  return flags.has(name);
}
